"""Identidades anónimas, bibliotecas privadas e invitaciones para la pizarra.

No implementa todavía mezcla CRDT de operaciones simultáneas: el guardado con
versiones y las notificaciones WebSocket existentes se mantienen.
"""
from __future__ import annotations

import hashlib
import hmac
import unicodedata
import json
import os
import re
import secrets
import sqlite3
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request, WebSocket
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

COOKIE = 'pizarra_sid'
SESSION_SECONDS = 90 * 86400
SESSION_PREFIX = '/api/auth/'
HEX_COLOR = re.compile(r'^#[0-9a-fA-F]{6}$')
AVATARS = ('😀','😎','🤓','🦊','🐱','🐼','🐸','🐙','🦋','🐝','🚀','🌈','🌻','🍀','⭐','🔥','🎨','🎯','🦄','🐧','🐢','🐺','🧠','👾')
PASSWORD_ITERATIONS = 350_000
BOARD_PATH = re.compile(r'^/api/boards/([^/]+)(?:/(.*))?$')
FOLDER_PATH = re.compile(r'^/api/folders/([^/]+)$')
ASSET_PATH = re.compile(r'^/api/assets/([^/]+)$')
CALENDAR_PATH = re.compile(r'^/api/calendars/([^/]+)$')
EVENT_PATH = re.compile(r'^/api/calendar/events/([^/]+)(?:/occurrences/[^/]+)?$')
_rate = defaultdict(deque)


def digest(value: str) -> str:
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def clean_name(name: str) -> str:
    name = ''.join(ch for ch in name.strip() if ch.isprintable()).strip()[:40]
    if not name:
        raise HTTPException(422, 'Escribí un nombre de invitado.')
    return name


def normalized_login(name: str) -> str:
    return ' '.join(unicodedata.normalize('NFKC', name).casefold().split())


def secure_password(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, PASSWORD_ITERATIONS).hex()


def check_password(password: str, user) -> bool:
    if not user or not user['password_salt'] or not user['password_hash']:
        return False
    try:
        expected = bytes.fromhex(user['password_hash'])
        calculated = bytes.fromhex(secure_password(password, bytes.fromhex(user['password_salt'])))
        return hmac.compare_digest(calculated, expected)
    except (ValueError, TypeError):
        return False


def validate_password(password: str):
    if not password:
        raise HTTPException(422, 'La contraseña no puede estar vacía.')
    # Límite técnico para evitar consumir recursos excesivos durante PBKDF2.
    if len(password.encode('utf-8')) > 4096:
        raise HTTPException(422, 'La contraseña es demasiado larga (máximo 4096 bytes).')


def profile_dict(row) -> dict:
    return {key: row[key] for key in ('id', 'display_name', 'color', 'is_admin', 'emoji')}


def find_user(db, token: str | None):
    if not token:
        return None
    return db.execute('''SELECT u.id, u.display_name, u.color, u.is_admin, u.emoji
        FROM anonymous_sessions s JOIN anonymous_users u ON u.id=s.user_id
        WHERE s.token_hash=? AND s.expires_at>?''', (digest(token), int(time.time()))).fetchone()


def board_role(db, uid: str, board_id: str) -> str | None:
    row = db.execute('''SELECT b.owner_user_id, m.role
        FROM boards b LEFT JOIN board_members m ON m.board_id=b.id AND m.user_id=?
        WHERE b.id=?''', (uid, board_id)).fetchone()
    if not row:
        return None
    return 'owner' if row['owner_user_id'] == uid else row['role']


def can_board(db, uid: str, board_id: str, required='viewer') -> bool:
    ranks = {'viewer': 1, 'editor': 2, 'owner': 3}
    return ranks.get(board_role(db, uid, board_id), 0) >= ranks[required]


def folder_owned(db, uid: str, folder_id: str) -> bool:
    return db.execute('SELECT 1 FROM folders WHERE id=? AND owner_user_id=?',
                      (folder_id, uid)).fetchone() is not None


def calendar_owned(db, uid: str, calendar_id: str) -> bool:
    return db.execute('SELECT 1 FROM calendars WHERE id=? AND owner_user_id=?',
                      (calendar_id, uid)).fetchone() is not None


def event_owned(db, uid: str, event_id: str) -> bool:
    return db.execute('SELECT 1 FROM calendar_events WHERE id=? AND owner_user_id=?',
                      (event_id, uid)).fetchone() is not None


def asset_access(db, uid: str, asset_id: str) -> bool:
    owner = db.execute('SELECT owner_user_id FROM assets WHERE id=?', (asset_id,)).fetchone()
    if not owner:
        return False
    if owner['owner_user_id'] == uid:
        return True
    return db.execute('''SELECT 1 FROM board_assets ba
        JOIN boards b ON b.id=ba.board_id
        LEFT JOIN board_members bm ON bm.board_id=b.id AND bm.user_id=?
        WHERE ba.asset_id=? AND (b.owner_user_id=? OR bm.role IN ('viewer','editor'))
        LIMIT 1''', (uid, asset_id, uid)).fetchone() is not None


def owner_id(db):
    row = db.execute('SELECT id FROM anonymous_users WHERE is_admin=1 LIMIT 1').fetchone()
    if not row:
        raise RuntimeError('No se creó el administrador de la pizarra')
    return row['id']


def migrate(db_connection, data_dir: Path):
    from reconocimiento_local.cloud_database import enabled
    if enabled():
        return  # Schema and original accounts were migrated explicitly.
    # Llamar con servidor detenido. La copia SQLite es consistente, incluso con WAL.
    with db_connection() as db:
        existing = {r['name'] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        needs_backup = 'anonymous_users' not in existing
        if needs_backup:
            backups = data_dir / 'backups'
            backups.mkdir(parents=True, exist_ok=True)
            snapshot = backups / ('pizarras-antes-usuarios-' + datetime.now().strftime('%Y%m%d-%H%M%S') + '.db')
            destination = sqlite3.connect(snapshot)
            try:
                db.backup(destination)
            finally:
                destination.close()
            os.chmod(snapshot, 0o600)
        db.executescript('''
        CREATE TABLE IF NOT EXISTS anonymous_users (
          id TEXT PRIMARY KEY, display_name TEXT NOT NULL, color TEXT NOT NULL,
          is_admin INTEGER NOT NULL DEFAULT 0, recovery_hash TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS anonymous_sessions (
          token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES anonymous_users(id) ON DELETE CASCADE,
          expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS board_members (
          board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES anonymous_users(id) ON DELETE CASCADE,
          role TEXT NOT NULL CHECK(role IN ('viewer','editor')),
          PRIMARY KEY (board_id,user_id)
        );
        CREATE TABLE IF NOT EXISTS hidden_boards (
          board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES anonymous_users(id) ON DELETE CASCADE,
          PRIMARY KEY (board_id,user_id)
        );
        CREATE TABLE IF NOT EXISTS share_links (
          id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK(role IN ('viewer','editor')),
          expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS board_assets (
          board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
          asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          PRIMARY KEY (board_id,asset_id)
        );
        CREATE TABLE IF NOT EXISTS share_codes (
          code TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
          expires_at INTEGER NOT NULL
        );
        ''')
        if 'folder_id' not in {r['name'] for r in db.execute('PRAGMA table_info(board_members)')}:
            db.execute('ALTER TABLE board_members ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL')
        for table in ('boards', 'folders', 'assets', 'calendars', 'calendar_events'):
            columns = {r['name'] for r in db.execute(f'PRAGMA table_info({table})')}
            if 'owner_user_id' not in columns:
                db.execute(f'ALTER TABLE {table} ADD COLUMN owner_user_id TEXT')
        admin = db.execute('SELECT id FROM anonymous_users WHERE is_admin=1 LIMIT 1').fetchone()
        if admin:
            aid = admin['id']
        else:
            aid = uuid.uuid4().hex
            code = 'admin-' + secrets.token_urlsafe(32)
            db.execute('''INSERT INTO anonymous_users
              (id,display_name,color,is_admin,recovery_hash,created_at)
              VALUES (?,?,?,?,?,?)''', (aid, 'Administrador', '#6366f1', 1, digest(code), utc_now()))
            keyfile = data_dir / 'CLAVE_ADMINISTRADOR.txt'
            with keyfile.open('x', encoding='utf-8') as f:
                f.write('Clave de recuperación del administrador de la pizarra.\n'
                        'NO la compartas ni la envíes por Internet.\n\n' + code + '\n')
            os.chmod(keyfile, 0o600)
        for table in ('boards', 'folders', 'assets', 'calendars', 'calendar_events'):
            db.execute(f'UPDATE {table} SET owner_user_id=? WHERE owner_user_id IS NULL', (aid,))
        # Vincular imágenes antiguas a pizarras sin modificarlas.
        for board in db.execute('SELECT id,content FROM boards').fetchall():
            try:
                media = json.loads(board['content']).get('media', [])
            except (ValueError, TypeError, AttributeError):
                media = []
            if isinstance(media, list):
                for item in media:
                    asset = item.get('assetId') if isinstance(item, dict) else None
                    if isinstance(asset, str):
                        db.execute('INSERT OR IGNORE INTO board_assets(board_id,asset_id) VALUES (?,?)',
                                   (board['id'], asset))
        # La API legada crea eventos sin owner_user_id. Triggers derivan el dueño
        # del calendario, incluso al mover un evento a otro calendario propio.
        db.executescript("""
        CREATE TRIGGER IF NOT EXISTS trg_anon_event_owner_insert
        AFTER INSERT ON calendar_events
        BEGIN
          UPDATE calendar_events SET owner_user_id=(
            SELECT owner_user_id FROM calendars WHERE id=NEW.calendar_id
          ) WHERE id=NEW.id;
        END;
        CREATE TRIGGER IF NOT EXISTS trg_anon_event_owner_update
        AFTER UPDATE OF calendar_id ON calendar_events
        BEGIN
          UPDATE calendar_events SET owner_user_id=(
            SELECT owner_user_id FROM calendars WHERE id=NEW.calendar_id
          ) WHERE id=NEW.id;
        END;
        """)
        # Evolución de cuentas existentes: conservamos sus claves de recuperación.
        existing_user_cols = {r['name'] for r in db.execute('PRAGMA table_info(anonymous_users)')}
        for name, ddl in (
            ('emoji', "TEXT NOT NULL DEFAULT '🙂'"),
            ('login_name', 'TEXT'),
            ('password_hash', 'TEXT'),
            ('password_salt', 'TEXT'),
        ):
            if name not in existing_user_cols:
                db.execute(f'ALTER TABLE anonymous_users ADD COLUMN {name} {ddl}')
        db.execute('CREATE UNIQUE INDEX IF NOT EXISTS ux_anon_login ON anonymous_users(login_name) WHERE login_name IS NOT NULL')
        db.execute('CREATE INDEX IF NOT EXISTS idx_anonymous_sessions_exp ON anonymous_sessions(expires_at)')
        db.execute('CREATE INDEX IF NOT EXISTS idx_owners_boards ON boards(owner_user_id)')
        db.execute('CREATE INDEX IF NOT EXISTS idx_owners_folders ON folders(owner_user_id)')
        db.execute('CREATE INDEX IF NOT EXISTS idx_owners_calendars ON calendars(owner_user_id)')


def origin_ok(origin: str | None, host: str) -> bool:
    if not origin:
        return True  # Herramientas de terminal no envían Origin; requieren sesión igualmente.
    parsed = urlsplit(origin)
    configured = {item.strip().rstrip('/') for item in os.environ.get('PIZARRA_PUBLIC_ORIGINS','').split(',') if item.strip()}
    if origin.rstrip('/') in configured and parsed.scheme == 'https':
        return True
    incoming_host = host.split(':', 1)[0].lower()
    site_host = (parsed.hostname or '').lower()
    if parsed.scheme not in ('http', 'https'):
        return False
    if site_host == incoming_host and (parsed.netloc.lower() == host.lower()):
        return True
    # Frontend Vite durante desarrollo: 5173 -> backend 8765, mismo equipo.
    return (incoming_host in ('127.0.0.1', 'localhost') and
            site_host in ('127.0.0.1', 'localhost') and parsed.port in range(5173, 5180))


def cookie_secure(request: Request) -> bool:
    host = (request.headers.get('host') or '').split(':')[0].lower()
    return request.url.scheme == 'https' or host not in ('localhost','127.0.0.1')


def issue_session(db, response: JSONResponse, request: Request, uid: str):
    raw = secrets.token_urlsafe(40)
    db.execute('INSERT INTO anonymous_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)',
               (digest(raw), uid, int(time.time()) + SESSION_SECONDS))
    response.set_cookie(COOKIE, raw, httponly=True, secure=cookie_secure(request),
                        samesite='lax', max_age=SESSION_SECONDS, path='/')


def rate_limit(request: Request, category: str = 'recover'):
    ident = request.client.host if request.client else 'unknown'
    from reconocimiento_local.cloud_database import enabled, connection
    if enabled():
        with connection() as db:
            count=db.execute('''INSERT INTO pizarra_rate(key,count,expires) VALUES (?,1,?)
              ON CONFLICT(key) DO UPDATE SET
                count=CASE WHEN pizarra_rate.expires<? THEN 1 ELSE pizarra_rate.count+1 END,
                expires=CASE WHEN pizarra_rate.expires<? THEN excluded.expires ELSE pizarra_rate.expires END
              RETURNING count''',(digest(ident+':'+category),time.time()+900,time.time(),time.time())).fetchone()[0]
        if count>=(31 if category=='guest' else 13):
            raise HTTPException(429,'Demasiados intentos. Espera 15 minutos.')
        return
    now = time.monotonic()
    attempts = _rate[(ident,category)]
    while attempts and now - attempts[0] > 900:
        attempts.popleft()
    if len(attempts) >= (30 if category == 'guest' else 12):
        raise HTTPException(429, 'Demasiados intentos. Esperá 15 minutos.')
    attempts.append(now)


class GuestInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    color: str = '#6366f1'
    password: str = Field(min_length=1, max_length=4096)
    emoji: str | None = None

class LoginInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=4096)

class ProfileEmojiInput(BaseModel):
    emoji: str

class SetPasswordInput(BaseModel):
    password: str = Field(min_length=1, max_length=4096)

class RecoveryInput(BaseModel):
    code: str = Field(min_length=20, max_length=200)

class InviteInput(BaseModel):
    role: str = Field(default='editor', pattern='^(viewer|editor)$')
    days: int = Field(default=7, ge=1, le=30)

class AdminDeleteInput(BaseModel):
    confirmation: str = Field(min_length=1, max_length=20)

class JoinInput(BaseModel):
    token: str = Field(min_length=15, max_length=200)

class JoinCodeInput(BaseModel):
    code: str = Field(pattern=r'^\d{4}$')


def attach_anonymous_users(app, db_connection, data_dir):
    migrate(db_connection, Path(data_dir))
    router = APIRouter()

    @router.get('/api/auth/me')
    def me(request: Request):
        with db_connection() as db:
            user = find_user(db, request.cookies.get(COOKIE))
            if not user:
                raise HTTPException(401, 'Sesión no iniciada')
            return dict(user)

    @router.post('/api/auth/guest')
    def create_guest(body: GuestInput, request: Request):
        rate_limit(request, 'guest')
        name = clean_name(body.name)
        login_name = normalized_login(name)
        validate_password(body.password)
        if not HEX_COLOR.fullmatch(body.color):
            raise HTTPException(422, 'Color inválido')
        if body.emoji is not None and body.emoji not in AVATARS:
            raise HTTPException(422, 'Emoji no admitido')
        emoji = body.emoji or secrets.choice(AVATARS)
        with db_connection() as db:
            if any(normalized_login(row['display_name']) == login_name for row in
                   db.execute('SELECT display_name FROM anonymous_users')):
                raise HTTPException(409, 'Ese nombre ya está ocupado. Elegí otro.')
            if db.execute('SELECT COUNT(*) FROM anonymous_users WHERE is_admin=0').fetchone()[0] >= 100:
                raise HTTPException(429, 'Límite de invitados alcanzado. Consultá al administrador.')
            uid = uuid.uuid4().hex
            salt = secrets.token_bytes(16)
            # La clave de recuperación heredada sigue existiendo internamente;
            # la contraseña elegida ahora permite iniciar sesión desde otras URLs.
            recovery = 'guest-' + secrets.token_urlsafe(32)
            db.execute('''INSERT INTO anonymous_users
                (id,display_name,color,is_admin,recovery_hash,created_at,emoji,login_name,password_hash,password_salt)
                VALUES (?,?,?,?,?,?,?,?,?,?)''',
                (uid, name, body.color, 0, digest(recovery), utc_now(), emoji,
                 login_name, secure_password(body.password, salt), salt.hex()))
            cal_id = uuid.uuid4().hex
            db.execute('INSERT INTO calendars(id,name,owner_user_id) VALUES (?,?,?)',
                       (cal_id, 'Personal', uid))
            response = JSONResponse({'id': uid, 'display_name': name, 'color': body.color,
                                     'is_admin': 0, 'emoji': emoji})
            issue_session(db, response, request, uid)
            return response

    @router.post('/api/auth/login')
    def login(body: LoginInput, request: Request):
        # Limitar intentos por nombre de cuenta; no confiar en headers de IP.
        name = normalized_login(clean_name(body.name))
        rate_limit(request, 'login:' + name)
        with db_connection() as db:
            user = db.execute('SELECT * FROM anonymous_users WHERE login_name=?', (name,)).fetchone()
            if not check_password(body.password, user):
                raise HTTPException(401, 'Nombre o contraseña incorrectos')
            response = JSONResponse(profile_dict(user))
            issue_session(db, response, request, user['id'])
            return response

    @router.post('/api/auth/set-password')
    def set_password(body: SetPasswordInput, request: Request):
        validate_password(body.password)
        with db_connection() as db:
            user = find_user(db, request.cookies.get(COOKIE))
            if not user:
                raise HTTPException(401, 'Iniciá sesión primero')
            login_name = normalized_login(user['display_name'])
            used = db.execute('SELECT id FROM anonymous_users WHERE login_name=?', (login_name,)).fetchone()
            if used and used['id'] != user['id']:
                raise HTTPException(409, 'El nombre ya está ocupado. Contactá al administrador.')
            salt = secrets.token_bytes(16)
            db.execute('UPDATE anonymous_users SET login_name=?,password_hash=?,password_salt=? WHERE id=?',
                       (login_name,secure_password(body.password,salt),salt.hex(),user['id']))
        return {'ok': True}

    @router.post('/api/auth/avatar')
    async def change_avatar(body: ProfileEmojiInput, request: Request):
        if body.emoji not in AVATARS:
            raise HTTPException(422, 'Emoji no admitido')
        with db_connection() as db:
            user = find_user(db, request.cookies.get(COOKIE))
            if not user:
                raise HTTPException(401, 'Iniciá sesión primero')
            db.execute('UPDATE anonymous_users SET emoji=? WHERE id=?', (body.emoji, user['id']))
            user_id = user['id']
        from reconocimiento_local.live_sync_api import notify_avatar_changed
        await notify_avatar_changed(user_id, body.emoji)
        return {'ok': True, 'emoji': body.emoji}

    @router.post('/api/auth/recover')
    def recover(body: RecoveryInput, request: Request):
        rate_limit(request)
        with db_connection() as db:
            row = db.execute('SELECT id,display_name,color,is_admin,emoji FROM anonymous_users WHERE recovery_hash=?',
                             (digest(body.code.strip()),)).fetchone()
            if not row:
                raise HTTPException(401, 'Clave de recuperación incorrecta')
            response = JSONResponse(dict(row))
            issue_session(db, response, request, row['id'])
            return response

    @router.post('/api/auth/logout')
    def logout(request: Request):
        with db_connection() as db:
            token = request.cookies.get(COOKIE)
            if token:
                db.execute('DELETE FROM anonymous_sessions WHERE token_hash=?', (digest(token),))
        response = JSONResponse({'ok': True})
        response.delete_cookie(COOKIE, path='/')
        return response

    @router.post('/api/share/boards/{board_id}')
    def new_share(board_id: str, body: InviteInput, request: Request):
        uid = request.state.user_id
        with db_connection() as db:
            if not can_board(db, uid, board_id, 'owner'):
                raise HTTPException(403, 'Solo el propietario puede compartir')
            if db.execute('SELECT COUNT(*) FROM share_links WHERE board_id=? AND revoked=0 AND expires_at>?',
                (board_id,int(time.time()))).fetchone()[0]>=30:
                raise HTTPException(429, 'Demasiadas invitaciones activas')
            token = secrets.token_urlsafe(32)
            db.execute('''INSERT INTO share_links(id,board_id,token_hash,role,expires_at)
                VALUES (?,?,?,?,?)''', (uuid.uuid4().hex, board_id, digest(token), body.role,
                                       int(time.time()) + body.days * 86400))
            return {'token': token, 'role': body.role, 'days': body.days}

    def accept_board(db, uid, board_id, role='editor'):
        # Membership and placement are personal. Rejoining never moves a board.
        db.execute('DELETE FROM hidden_boards WHERE board_id=? AND user_id=?', (board_id, uid))
        existing = board_role(db, uid, board_id)
        if not existing:
            folder = db.execute('SELECT id FROM folders WHERE owner_user_id=? AND name=? ORDER BY created_at LIMIT 1',
                                (uid, 'Pizarra compartida')).fetchone()
            fid = folder['id'] if folder else uuid.uuid4().hex
            if not folder:
                db.execute('INSERT INTO folders(id,name,created_at,owner_user_id) VALUES(?,?,?,?)',
                           (fid, 'Pizarra compartida', utc_now(), uid))
            db.execute('INSERT INTO board_members(board_id,user_id,role,folder_id) VALUES(?,?,?,?)',
                       (board_id, uid, role, fid))
        return {'ok': True, 'board_id': board_id, 'role': existing or role}

    @router.post('/api/share/boards/{board_id}/code')
    def new_code(board_id: str, request: Request):
        with db_connection() as db:
            if not can_board(db, request.state.user_id, board_id, 'owner'):
                raise HTTPException(403, 'Solo el propietario puede compartir')
            db.execute('BEGIN IMMEDIATE')
            now = int(time.time())
            db.execute('DELETE FROM share_codes WHERE expires_at<=?', (now,))
            previous = db.execute('SELECT code,expires_at FROM share_codes WHERE board_id=?', (board_id,)).fetchone()
            if previous:
                return dict(previous)
            for _ in range(100):
                code = str(1000 + secrets.randbelow(9000))
                if not db.execute('SELECT 1 FROM share_codes WHERE code=?', (code,)).fetchone():
                    expires = now + 86400
                    db.execute('INSERT INTO share_codes VALUES(?,?,?)', (code, board_id, expires))
                    return {'code': code, 'expires_at': expires}
            raise HTTPException(503, 'No hay códigos disponibles. Probá nuevamente.')

    @router.post('/api/share/join-code')
    def join_code(body: JoinCodeInput, request: Request):
        rate_limit(request, 'share-code:' + request.state.user_id)
        with db_connection() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT board_id FROM share_codes WHERE code=? AND expires_at>?',
                             (body.code, int(time.time()))).fetchone()
            if not row:
                raise HTTPException(404, 'Código inexistente o vencido')
            db.execute("UPDATE board_members SET role='editor' WHERE board_id=? AND user_id=? AND role='viewer'", (row['board_id'],request.state.user_id))
            return accept_board(db, request.state.user_id, row['board_id'])

    @router.post('/api/share/join')
    def join_share(body: JoinInput, request: Request):
        with db_connection() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('''SELECT board_id,role FROM share_links
                WHERE token_hash=? AND revoked=0 AND expires_at>?''',
                (digest(body.token), int(time.time()))).fetchone()
            if not row:
                raise HTTPException(404, 'Invitación inválida o vencida')
            return accept_board(db, request.state.user_id, row['board_id'], row['role'])

    @router.get('/api/share/boards/{board_id}')
    def share_members(board_id: str, request: Request):
        uid = request.state.user_id
        with db_connection() as db:
            if not can_board(db, uid, board_id, 'owner'):
                raise HTTPException(403, 'Solo el propietario puede ver los participantes')
            rows = db.execute('''SELECT u.id,u.display_name,u.color,m.role FROM board_members m
                JOIN anonymous_users u ON u.id=m.user_id WHERE m.board_id=?''', (board_id,)).fetchall()
            return {'members': [dict(r) for r in rows]}

    @router.delete('/api/share/boards/{board_id}/members/{user_id}')
    def remove_member(board_id: str, user_id: str, request: Request):
        with db_connection() as db:
            if not can_board(db, request.state.user_id, board_id, 'owner'):
                raise HTTPException(403, 'Solo el propietario puede quitar participantes')
            db.execute('DELETE FROM board_members WHERE board_id=? AND user_id=?', (board_id,user_id))
            return {'ok': True}

    # Gestión de invitados: únicamente mediante sesión de administrador.
    # No se ofrecen hashes de contraseñas, tokens ni claves de recuperación.
    def assert_admin(request: Request, db):
        user = find_user(db, request.cookies.get(COOKIE))
        if not user:
            raise HTTPException(401, 'Iniciá sesión')
        if not user['is_admin']:
            raise HTTPException(403, 'Solo el administrador puede gestionar usuarios')
        return user

    @router.get('/api/admin/users')
    def list_managed_users(request: Request):
        with db_connection() as db:
            assert_admin(request, db)
            rows = db.execute('''SELECT u.id,u.display_name,u.emoji,u.is_admin,
                (SELECT COUNT(*) FROM boards WHERE owner_user_id=u.id) AS boards_count,
                (SELECT COUNT(*) FROM folders WHERE owner_user_id=u.id) AS folders_count,
                (SELECT COUNT(*) FROM calendar_events WHERE owner_user_id=u.id) AS events_count
                FROM anonymous_users u ORDER BY u.is_admin DESC,u.display_name COLLATE NOCASE''').fetchall()
            return {'users':[dict(row) for row in rows]}

    @router.post('/api/admin/users/{target_id}/delete')
    def delete_managed_user(target_id: str, body: AdminDeleteInput, request: Request):
        if body.confirmation != 'ELIMINAR':
            raise HTTPException(422, 'Confirmación incorrecta')
        with db_connection() as db:
            assert_admin(request, db)
            target = db.execute('SELECT id,is_admin,display_name FROM anonymous_users WHERE id=?', (target_id,)).fetchone()
            if not target:
                raise HTTPException(404, 'Usuario inexistente')
            if target['is_admin']:
                raise HTTPException(403, 'No está permitido eliminar al administrador')
            # Crear un respaldo consistente ANTES de iniciar la eliminación.
            backup_dir = Path(data_dir)/'backups'
            backup_dir.mkdir(parents=True, exist_ok=True)
            filename = 'antes-eliminar-invitado-' + datetime.now().strftime('%Y%m%d-%H%M%S-%f') + '.db'
            destination = backup_dir/filename
            other = sqlite3.connect(destination)
            try:
                db.backup(other)
            finally:
                other.close()
            try:
                os.chmod(destination, 0o600)
            except OSError:
                pass
            # Una transacción garantiza que no queden borrados a medias.
            db.execute('BEGIN IMMEDIATE')
            target = db.execute('SELECT is_admin FROM anonymous_users WHERE id=?',(target_id,)).fetchone()
            if not target or target['is_admin']:
                db.rollback()
                raise HTTPException(409, 'El usuario cambió. Actualizá la lista.')
            db.execute('''DELETE FROM calendar_event_exceptions WHERE event_id IN
                          (SELECT id FROM calendar_events WHERE owner_user_id=?)''', (target_id,))
            db.execute('DELETE FROM calendar_events WHERE owner_user_id=?', (target_id,))
            db.execute('DELETE FROM calendars WHERE owner_user_id=?', (target_id,))
            db.execute('DELETE FROM boards WHERE owner_user_id=?', (target_id,))
            db.execute('DELETE FROM folders WHERE owner_user_id=?', (target_id,))
            db.execute('''DELETE FROM assets WHERE owner_user_id=? AND NOT EXISTS
                (SELECT 1 FROM board_assets WHERE asset_id=assets.id)''', (target_id,))
            db.execute('UPDATE assets SET owner_user_id=? WHERE owner_user_id=?',
                       (owner_id(db), target_id))
            db.execute('DELETE FROM anonymous_users WHERE id=? AND is_admin=0', (target_id,))
            # Con foreign_keys=ON: sesiones, invitaciones y membresías asociadas se eliminan por cascada.
            return {'ok': True, 'backup': filename}

    app.include_router(router)

    @app.middleware('http')
    async def protect_http(request: Request, call_next):
        path, method = request.url.path, request.method
        if method == 'OPTIONS' or not (path.startswith('/api/') or path == '/health'):
            return await call_next(request)
        if method not in ('GET','HEAD','OPTIONS') and not origin_ok(request.headers.get('origin'), request.headers.get('host','')):
            return JSONResponse({'detail': 'Origen no autorizado'}, status_code=403)
        if path in ('/api/auth/me','/api/auth/guest','/api/auth/login','/api/auth/recover','/api/auth/logout','/api/auth/avatar','/api/auth/set-password'):
            return await call_next(request)
        # Buffer JSON before acquiring a database connection; never keep one
        # checked out while waiting for an upload or another request handler.
        if method in ('POST','PUT','PATCH') and path.startswith(('/api/boards','/api/folders','/api/calendars','/api/calendar/events')):
            await request.body()
        separate_permissions=path.startswith('/api/share/') or path=='/api/admin/users' or path.startswith('/api/admin/users/')
        with db_connection() as db:
            user = find_user(db, request.cookies.get(COOKIE))
            if not user:
                return JSONResponse({'detail': 'Iniciá sesión como invitado'}, status_code=401)
            uid = user['id']
            request.state.user_id = uid
            # Share/admin routes check their own roles after this connection
            # is released, rather than reserving two pool slots per request.
            if path == '/api/library' and method == 'GET':
                folders = [dict(r) for r in db.execute('''SELECT id,name FROM folders
                    WHERE owner_user_id=? ORDER BY name''', (uid,))]
                boards = [dict(r) for r in db.execute('''SELECT b.id,b.name,
                    CASE WHEN b.owner_user_id=? THEN b.folder_id ELSE m.folder_id END AS folder_id,
                    b.version,b.updated_at,
                    CASE WHEN b.owner_user_id=? THEN 'owner' ELSE m.role END AS role
                    FROM boards b LEFT JOIN board_members m ON m.board_id=b.id AND m.user_id=?
                    WHERE (b.owner_user_id=? OR m.user_id=?) AND NOT EXISTS
                    (SELECT 1 FROM hidden_boards h WHERE h.board_id=b.id AND h.user_id=?)
                    ORDER BY b.updated_at DESC''',
                    (uid,uid,uid,uid,uid,uid))]
                return JSONResponse({'folders': folders, 'boards': boards})
            if path == '/api/folders' and method == 'POST':
                try:
                    body = await request.json()
                    name = str(body.get('name','')).strip()[:120]
                except (ValueError, AttributeError):
                    name = ''
                if not name:
                    return JSONResponse({'detail':'Nombre obligatorio'},status_code=422)
                if db.execute('SELECT COUNT(*) FROM folders WHERE owner_user_id=?',(uid,)).fetchone()[0]>=100:
                    return JSONResponse({'detail':'Límite de carpetas alcanzado'},status_code=429)
                fid = uuid.uuid4().hex
                db.execute('INSERT INTO folders(id,name,created_at,owner_user_id) VALUES(?,?,?,?)',
                           (fid,name,utc_now(),uid))
                db.commit()
                return JSONResponse({'id':fid,'name':name})
            folder_match = FOLDER_PATH.fullmatch(path)
            if folder_match and not folder_owned(db, uid, folder_match.group(1)):
                return JSONResponse({'detail':'Carpeta inexistente'},status_code=404)
            if path == '/api/boards' and method == 'POST':
                try:
                    body = await request.json()
                    name = str(body.get('name','')).strip()[:120]
                    folder_id = body.get('folder_id')
                except (ValueError, AttributeError):
                    return JSONResponse({'detail':'Datos inválidos'},status_code=422)
                if not name or (folder_id is not None and not isinstance(folder_id,str)):
                    return JSONResponse({'detail':'Datos inválidos'},status_code=422)
                if folder_id and not folder_owned(db,uid,folder_id):
                    return JSONResponse({'detail':'Carpeta inexistente'},status_code=404)
                if db.execute('SELECT COUNT(*) FROM boards WHERE owner_user_id=?',(uid,)).fetchone()[0]>=100:
                    return JSONResponse({'detail':'Límite de pizarras alcanzado'},status_code=429)
                bid = uuid.uuid4().hex
                db.execute('''INSERT INTO boards(id,name,folder_id,content,updated_at,owner_user_id)
                    VALUES(?,?,?,?,?,?)''',(bid,name,folder_id,'{}',utc_now(),uid))
                db.commit()
                return JSONResponse({'id':bid,'name':name,'version':0})
            board_match = BOARD_PATH.fullmatch(path)
            if board_match:
                bid, subpath = board_match.group(1), board_match.group(2) or ''
                required = 'viewer'
                if method in ('PUT','POST','PATCH','DELETE'):
                    required = 'editor'
                if (method == 'DELETE' and subpath) or '/restore' in subpath:
                    required = 'owner'
                if not subpath and method == 'DELETE':
                    required = 'viewer'
                if subpath == 'info':
                    required = 'viewer'
                if subpath.startswith('history') and method == 'DELETE':
                    required = 'owner'
                if not can_board(db,uid,bid,required):
                    return JSONResponse({'detail':'Sin permisos para esta pizarra'},status_code=403)
                if path.endswith('/info') and method == 'PUT':
                    try:
                        body = await request.json()
                        folder_id = body.get('folder_id')
                    except (ValueError, AttributeError):
                        return JSONResponse({'detail':'Datos inválidos'},status_code=422)
                    if folder_id and not folder_owned(db,uid,folder_id):
                        return JSONResponse({'detail':'Carpeta ajena'},status_code=403)
                    if not can_board(db,uid,bid,'owner'):
                        db.execute('UPDATE board_members SET folder_id=? WHERE board_id=? AND user_id=?', (folder_id,bid,uid))
                        db.commit()
                        return JSONResponse({'ok':True})
                if not subpath and method == 'PUT':
                    try:
                        if len(await request.body()) > 16*1024*1024:
                            return JSONResponse({'detail':'Pizarra demasiado grande'},status_code=413)
                        payload = await request.json()
                        media = payload.get('content',{}).get('media',[])
                        if not isinstance(media,list) or len(media)>2500:
                            raise ValueError()
                        ids = {m['assetId'] for m in media if isinstance(m,dict) and isinstance(m.get('assetId'),str)}
                    except (ValueError,AttributeError,TypeError):
                        return JSONResponse({'detail':'Contenido inválido'},status_code=422)
                    for asset in ids:
                        owned = db.execute('SELECT 1 FROM assets WHERE id=? AND owner_user_id=?', (asset,uid)).fetchone()
                        linked = db.execute('SELECT 1 FROM board_assets WHERE board_id=? AND asset_id=?', (bid,asset)).fetchone()
                        if not (owned or linked):
                            return JSONResponse({'detail':'Imagen sin permisos'},status_code=403)
                    # The handler saves the scene and asset links atomically
                    # after this validation connection has been released.
            asset_match = ASSET_PATH.fullmatch(path)
            if asset_match:
                asset_id = asset_match.group(1)
                if method == 'GET' and not asset_access(db,uid,asset_id):
                    return JSONResponse({'detail':'Imagen no disponible'},status_code=404)
                if method == 'PUT':
                    existing = db.execute('SELECT owner_user_id FROM assets WHERE id=?',(asset_id,)).fetchone()
                    if existing and existing['owner_user_id']!=uid:
                        return JSONResponse({'detail':'Imagen de otro usuario'},status_code=403)
            # Calendarios: API propia aislada por usuario, sin romper los antiguos.
            if path == '/api/calendars' and method == 'GET':
                return JSONResponse([dict(row) for row in db.execute('''SELECT id,name FROM calendars
                    WHERE owner_user_id=? ORDER BY rowid''',(uid,))])
            if path == '/api/calendars' and method == 'POST':
                try:
                    body=await request.json(); name=str(body.get('name','')).strip()
                except (ValueError,AttributeError):
                    name=''
                if not name or len(name)>40:
                    return JSONResponse({'detail':'Nombre inválido'},status_code=422)
                if db.execute('SELECT COUNT(*) FROM calendars WHERE owner_user_id=?',(uid,)).fetchone()[0]>=4:
                    return JSONResponse({'detail':'Máximo cuatro calendarios'},status_code=409)
                cid=uuid.uuid4().hex
                db.execute('INSERT INTO calendars(id,name,owner_user_id) VALUES (?,?,?)',(cid,name,uid))
                db.commit()
                return JSONResponse({'id':cid,'name':name})
            calendar_match=CALENDAR_PATH.fullmatch(path)
            if calendar_match:
                cid=calendar_match.group(1)
                if not calendar_owned(db,uid,cid):
                    return JSONResponse({'detail':'Calendario inexistente'},status_code=404)
                if method=='DELETE':
                    if db.execute('SELECT COUNT(*) FROM calendars WHERE owner_user_id=?',(uid,)).fetchone()[0]<=1:
                        return JSONResponse({'detail':'No se puede eliminar el último calendario'},status_code=409)
                    db.execute('DELETE FROM calendar_event_exceptions WHERE event_id IN (SELECT id FROM calendar_events WHERE calendar_id=?)',(cid,))
                    db.execute('DELETE FROM calendar_events WHERE calendar_id=?',(cid,))
                    db.execute('DELETE FROM calendars WHERE id=?',(cid,))
                    db.commit()
                    return JSONResponse({'ok':True})
            if path=='/api/calendar/events' and method=='GET':
                events=[dict(r) for r in db.execute('''SELECT id,date,title,time,notes,color,calendar_id,recurrence
                    FROM calendar_events WHERE owner_user_id=? ORDER BY date,time,title''',(uid,))]
                for event in events:
                    event['excluded_dates']=[r[0] for r in db.execute('SELECT occurrence_date FROM calendar_event_exceptions WHERE event_id=?',(event['id'],))]
                return JSONResponse(events)
            if path=='/api/calendar/events' and method=='POST':
                try:
                    body=await request.json(); calendar_id=body.get('calendar_id')
                except (ValueError,AttributeError):
                    return JSONResponse({'detail':'Datos inválidos'},status_code=422)
                if not isinstance(calendar_id,str) or not calendar_owned(db,uid,calendar_id):
                    return JSONResponse({'detail':'Calendario ajeno'},status_code=403)
                # The insertion trigger associates the owner in the handler.
            event_match=EVENT_PATH.fullmatch(path)
            if event_match:
                eid=event_match.group(1)
                if not event_owned(db,uid,eid):
                    return JSONResponse({'detail':'Evento inexistente'},status_code=404)
                if method=='PUT':
                    try:
                        body=await request.json(); calendar_id=body.get('calendar_id')
                    except (ValueError,AttributeError):
                        return JSONResponse({'detail':'Datos inválidos'},status_code=422)
                    if not isinstance(calendar_id,str) or not calendar_owned(db,uid,calendar_id):
                        return JSONResponse({'detail':'Calendario ajeno'},status_code=403)
            # Los otros endpoints /api y /recognize requieren sesión; por defecto no
            # exponer futuras rutas nuevas que puedan saltarse el control de permisos.
            allowed = (separate_permissions or path=='/api/calendar/events' or path.startswith('/api/chatgpt/') or path.startswith('/api/study-ai/') or path == '/api/code/run' or path.startswith('/api/code/results/') or
                       path == '/health' or path.startswith('/api/excel/') or
                       path.startswith('/api/calendar/parse-handwriting') or path.startswith('/api/boards/') or
                       path.startswith('/api/folders/') or path.startswith('/api/assets/') or
                       path.startswith('/api/calendars/') or path.startswith('/api/calendar/events/'))
            if not allowed:
                return JSONResponse({'detail':'Ruta no habilitada'},status_code=403)
        return await call_next(request)


def websocket_allowed(websocket: WebSocket, board_id: str, db_connection, ticket_user_id: str | None = None) -> tuple[bool,str|None]:
    host = websocket.headers.get('host','')
    if not origin_ok(websocket.headers.get('origin'), host):
        return False,None
    with db_connection() as db:
        user=(db.execute('SELECT id FROM anonymous_users WHERE id=?',(ticket_user_id,)).fetchone()
              if ticket_user_id else find_user(db,websocket.cookies.get(COOKIE)))
        if not user or not can_board(db,user['id'],board_id,'viewer'):
            return False,None
        return True,user['id']
