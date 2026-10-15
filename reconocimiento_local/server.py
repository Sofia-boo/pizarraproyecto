"""Servidor de pizarras, calendario e integración opcional con ChatGPT."""
import json
import re
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app=FastAPI(title='Pizarra de estudio')

@app.get('/healthz')
@app.get('/health')
def readiness():
    with db_connection() as db:
        db.execute('SELECT 1').fetchone()
    return {'ok':True}

app.add_middleware(CORSMiddleware,
    allow_origin_regex=r'^http://(localhost|127\.0\.0\.1|(?:[0-9]{1,3}\.){3}[0-9]{1,3}):517[3-9]$',
    allow_methods=['GET','POST','PUT','DELETE'],allow_headers=['Content-Type','Range'],
    expose_headers=['Content-Range'])

# Biblioteca de pizarras: SQLite y recursos binarios en el equipo servidor.
import sqlite3
import uuid
from pathlib import Path
from datetime import datetime, timezone
from fastapi import Request as HTTPRequest
from fastapi.responses import Response

from reconocimiento_local.storage_paths import DATA_DIR
from reconocimiento_local import cloud_database
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_FILE = DATA_DIR / 'pizarras.db'

class _ClosingConnection(sqlite3.Connection):
    def __exit__(self, exc_type, exc_value, traceback):
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()


def db_connection():
    if cloud_database.enabled():
        return cloud_database.connection()
    con = sqlite3.connect(DB_FILE, timeout=15, factory=_ClosingConnection)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA journal_mode=WAL')
    con.execute('PRAGMA foreign_keys=ON')
    return con

def init_library():
    if cloud_database.enabled():
        with db_connection() as db:
            if not db.execute("SELECT 1 FROM pizarra_meta WHERE key='schema_version' AND value='1'").fetchone():
                raise RuntimeError('Primero hay que migrar la base de datos; no se crea una biblioteca vacia en produccion.')
        return
    with db_connection() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS folders (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS boards (
            id TEXT PRIMARY KEY, folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
            name TEXT NOT NULL, content TEXT NOT NULL DEFAULT '{}',
            version INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS assets (
            id TEXT PRIMARY KEY, data BLOB NOT NULL, mime TEXT NOT NULL
        );
        """)
        if not db.execute('SELECT 1 FROM boards LIMIT 1').fetchone():
            now = datetime.now(timezone.utc).isoformat()
            db.execute('INSERT INTO boards (id,name,content,updated_at) VALUES (?,?,?,?)',
                       ('principal', 'Mi primera pizarra', '{}', now))

init_library()

class FolderInput(BaseModel):
    name: str

class BoardInput(BaseModel):
    name: str
    folder_id: str | None = None

class BoardSave(BaseModel):
    content: dict | None = None
    version: int
    changes: dict | None = None
    camera: dict | None = None
    discarded_strokes: list[str] = Field(default_factory=list, max_length=50000)

@app.get('/api/library')
def get_library():
    with db_connection() as db:
        return {'folders': [dict(r) for r in db.execute('SELECT * FROM folders ORDER BY name')],
                'boards': [dict(r) for r in db.execute('SELECT id,name,folder_id,version,updated_at FROM boards ORDER BY updated_at DESC')]}

@app.post('/api/folders')
def create_folder(item: FolderInput):
    name = item.name.strip()[:120]
    if not name: raise HTTPException(400, 'El nombre es obligatorio')
    folder_id = str(uuid.uuid4())
    with db_connection() as db:
        db.execute('INSERT INTO folders VALUES (?,?,?)', (folder_id, name, datetime.now(timezone.utc).isoformat()))
    return {'id': folder_id, 'name': name}

@app.put('/api/folders/{folder_id}')
def rename_folder(folder_id: str, item: FolderInput):
    with db_connection() as db:
        cur = db.execute('UPDATE folders SET name=? WHERE id=?', (item.name.strip()[:120], folder_id))
        if not cur.rowcount: raise HTTPException(404, 'Carpeta inexistente')
    return {'ok': True}

@app.delete('/api/folders/{folder_id}')
def delete_folder(folder_id: str):
    with db_connection() as db:
        db.execute('UPDATE boards SET folder_id=NULL WHERE folder_id=?', (folder_id,))
        db.execute('DELETE FROM folders WHERE id=?', (folder_id,))
    return {'ok': True}

@app.post('/api/boards')
def create_board(item: BoardInput):
    name = item.name.strip()[:120]
    if not name: raise HTTPException(400, 'El nombre es obligatorio')
    board_id = str(uuid.uuid4())
    with db_connection() as db:
        if item.folder_id and not db.execute('SELECT 1 FROM folders WHERE id=?', (item.folder_id,)).fetchone():
            raise HTTPException(404, 'Carpeta inexistente')
        db.execute('INSERT INTO boards (id,name,folder_id,content,updated_at) VALUES (?,?,?,?,?)',
                   (board_id, name, item.folder_id, '{}', datetime.now(timezone.utc).isoformat()))
    return {'id': board_id, 'name': name, 'version': 0}

@app.get('/api/boards/{board_id}')
def read_board(board_id: str):
    with db_connection() as db:
        row = db.execute('SELECT * FROM boards WHERE id=?', (board_id,)).fetchone()
    if not row: raise HTTPException(404, 'Pizarra inexistente')
    return {'id': row['id'], 'name': row['name'], 'version': row['version'], 'content': json.loads(row['content'])}

@app.put('/api/boards/{board_id}')
async def save_board(board_id: str, item: BoardSave):
    from reconocimiento_local.visual_objects import validate_visual_content
    from reconocimiento_local.live_sync_api import apply_scene_changes, apply_scene_removals
    if any(not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', identifier) for identifier in item.discarded_strokes):
        raise HTTPException(422, 'Identificador de trazo inválido.')
    discarded = set(item.discarded_strokes)
    with db_connection() as db:
        row = db.execute('SELECT version,content FROM boards WHERE id=?', (board_id,)).fetchone()
        if not row: raise HTTPException(404, 'Pizarra inexistente')
        if row['version'] != item.version:
            raise HTTPException(409, 'Esta pizarra fue modificada en otra pestaña. Recargá antes de guardar.')
        before = json.loads(row['content'])
        if item.content is None:
            content=apply_scene_removals(before,item.changes,item.camera)
        else:
            content = apply_scene_changes(before, item.content, item.changes) if item.changes is not None else item.content
        if discarded:
            strokes = content.get('strokes', [])
            if not isinstance(strokes, list) or any(not isinstance(stroke, dict) for stroke in strokes):
                raise HTTPException(422, 'La colección de trazos no es válida.')
            content = {**content, 'strokes': [stroke for stroke in strokes
                                           if stroke.get('id') not in discarded]}
        validate_visual_content(content)
        new_version = item.version + 1
        saved = db.execute('UPDATE boards SET content=?, version=?, updated_at=? WHERE id=? AND version=?',
                   (json.dumps(content, ensure_ascii=False), new_version,
                    datetime.now(timezone.utc).isoformat(), board_id, item.version))
        if not saved.rowcount:
            raise HTTPException(409, 'La pizarra cambio durante el guardado; se combinaran los cambios.')
        # Publish image permissions in the SAME transaction as the scene, before
        # notifying peers. Otherwise the first GET after a WS event returns 404.
        db.execute('DELETE FROM board_assets WHERE board_id=?', (board_id,))
        for media in content.get('media', []):
            if isinstance(media, dict) and isinstance(media.get('assetId'), str):
                db.execute('INSERT OR IGNORE INTO board_assets VALUES (?,?)',
                           (board_id, media['assetId']))
    from reconocimiento_local.live_sync_api import notify_board_saved
    await notify_board_saved(board_id, new_version, before, content, item.discarded_strokes)
    return {'version': new_version, **({'content': content} if item.content is not None and content != item.content else {})}

@app.put('/api/boards/{board_id}/info')
def update_board_info(board_id: str, item: BoardInput):
    with db_connection() as db:
        if item.folder_id and not db.execute('SELECT 1 FROM folders WHERE id=?', (item.folder_id,)).fetchone():
            raise HTTPException(404, 'Carpeta inexistente')
        cur = db.execute('UPDATE boards SET name=?,folder_id=? WHERE id=?', (item.name.strip()[:120],item.folder_id,board_id))
        if not cur.rowcount: raise HTTPException(404, 'Pizarra inexistente')
    return {'ok': True}

@app.delete('/api/boards/{board_id}')
def delete_board(board_id: str, request: HTTPRequest):
    from reconocimiento_local.anonymous_users import can_board
    with db_connection() as db:
        uid = getattr(request.state, 'user_id', None)
        if not uid or not can_board(db, uid, board_id):
            raise HTTPException(403, 'Sin permisos para esta pizarra')
        # Removing a shared board is personal, even for its creator. Never
        # delete its content, memberships, assets, history or invitations here.
        db.execute('INSERT OR IGNORE INTO hidden_boards(board_id,user_id) VALUES(?,?)', (board_id, uid))
    return {'ok': True}

@app.put('/api/assets/{asset_id}')
async def put_asset(asset_id: str, request: HTTPRequest):
    data = await request.body()
    if len(data) > 30_000_000: raise HTTPException(413, 'Archivo demasiado grande')
    mime = request.headers.get('content-type', 'image/png').split(';')[0]
    if mime not in ('image/png','image/jpeg','image/webp'):
        raise HTTPException(415, 'Formato no admitido')
    upload_id = request.query_params.get('upload_id')
    if upload_id:
        import time
        if not cloud_database.enabled() or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',upload_id):
            raise HTTPException(400,'Carga dividida no disponible')
        try:
            offset=int(request.query_params.get('offset','-1'))
            total=int(request.query_params.get('total','0'))
        except ValueError:
            raise HTTPException(400,'Parte de archivo invalida')
        if not 0<total<=30_000_000 or not 0<=offset<total or not 0<len(data)<=1_000_000 or offset+len(data)>total:
            raise HTTPException(413,'Parte de archivo demasiado grande')
        uid=request.state.user_id
        with db_connection() as db:
            db.execute('SELECT pg_advisory_xact_lock(hashtextextended(?,0))',('asset:'+asset_id,))
            row=db.execute('SELECT * FROM pizarra_asset_uploads WHERE asset_id=? AND user_id=? AND upload_id=?',
                           (asset_id,uid,upload_id)).fetchone()
            if row:
                if row['total']!=total or row['mime']!=mime or offset!=row['next_offset']:
                    raise HTTPException(409,'Reinicia la transferencia del archivo')
                merged=bytes(row['data'])+data
            elif offset==0:merged=data
            else:raise HTTPException(409,'Falta la primera parte del archivo')
            if len(merged)==total:
                owner=db.execute('SELECT owner_user_id FROM assets WHERE id=?',(asset_id,)).fetchone()
                if owner and owner['owner_user_id']!=uid:raise HTTPException(403,'Imagen de otro usuario')
                written=db.execute('''INSERT INTO assets(id,data,mime,owner_user_id) VALUES(?,?,?,?)
                  ON CONFLICT(id) DO UPDATE SET data=excluded.data,mime=excluded.mime
                  WHERE assets.owner_user_id=excluded.owner_user_id''',(asset_id,merged,mime,uid))
                if not written.rowcount:raise HTTPException(403,'Imagen de otro usuario')
                db.execute('DELETE FROM pizarra_asset_uploads WHERE asset_id=? AND user_id=?',(asset_id,uid))
            else:
                db.execute('''INSERT INTO pizarra_asset_uploads VALUES(?,?,?,?,?,?,?,?)
                  ON CONFLICT(asset_id,user_id,upload_id) DO UPDATE SET data=excluded.data,
                  next_offset=excluded.next_offset,updated=excluded.updated''',
                  (asset_id,uid,upload_id,mime,total,len(merged),merged,time.time()))
        return {'ok':True,'complete':len(merged)==total}
    with db_connection() as db:
        written=db.execute('''INSERT INTO assets (id,data,mime,owner_user_id) VALUES (?,?,?,?)
                      ON CONFLICT(id) DO UPDATE SET data=excluded.data,mime=excluded.mime
                      WHERE assets.owner_user_id=excluded.owner_user_id''',
                   (asset_id,data,mime,request.state.user_id))
        if not written.rowcount:raise HTTPException(403,'Imagen de otro usuario')
    return {'ok': True}

@app.get('/api/assets/{asset_id}')
def get_asset(asset_id: str, request: HTTPRequest):
    requested=request.headers.get('range')
    if requested:
        match=re.fullmatch(r'bytes=(\d+)-(\d+)',requested)
        if not match:raise HTTPException(416,'Rango invalido')
        start,end=map(int,match.groups())
        if end<start or end-start>=1_000_000:raise HTTPException(416,'Rango invalido')
        with db_connection() as db:
            row=db.execute('SELECT substr(data,?,?) AS data,length(data) AS total,mime FROM assets WHERE id=?',
                           (start+1,end-start+1,asset_id)).fetchone()
        if not row:raise HTTPException(404,'Imagen inexistente')
        total=row['total']
        if start>=total:raise HTTPException(416,'Rango invalido')
        end=min(end,total-1)
        return Response(content=bytes(row['data']),status_code=206,media_type=row['mime'],
                        headers={'Content-Range':f'bytes {start}-{end}/{total}','Accept-Ranges':'bytes'})
    with db_connection() as db:
        row = db.execute('SELECT data,mime FROM assets WHERE id=?',(asset_id,)).fetchone()
    if not row: raise HTTPException(404, 'Imagen inexistente')
    if cloud_database.enabled() and len(row['data'])>4_000_000:
        raise HTTPException(413,'Actualiza la aplicacion para descargar este archivo grande')
    return Response(content=row['data'], media_type=row['mime'])


# Eventos del calendario, persistidos en la misma base SQLite de las pizarras.
from fastapi import HTTPException
with db_connection() as _db:
    _db.execute("""CREATE TABLE IF NOT EXISTS calendar_events (
        id TEXT PRIMARY KEY, date TEXT NOT NULL, title TEXT NOT NULL,
        time TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL DEFAULT '#f97316'
    )""")
    _cols = {row[1] for row in _db.execute("PRAGMA table_info(calendar_events)")}
    if "color" not in _cols:
        _db.execute("ALTER TABLE calendar_events ADD COLUMN color TEXT NOT NULL DEFAULT '#f97316'")

with db_connection() as _db:
    _db.execute("""CREATE TABLE IF NOT EXISTS calendars (id TEXT PRIMARY KEY, name TEXT NOT NULL)""")
    _db.execute("INSERT OR IGNORE INTO calendars(id,name) VALUES ('default','Personal')")
    _cols = {row[1] for row in _db.execute("PRAGMA table_info(calendar_events)")}
    if 'calendar_id' not in _cols:
        _db.execute("ALTER TABLE calendar_events ADD COLUMN calendar_id TEXT NOT NULL DEFAULT 'default'")
    if 'recurrence' not in _cols:
        _db.execute("ALTER TABLE calendar_events ADD COLUMN recurrence TEXT NOT NULL DEFAULT 'none'")
    _db.execute("""CREATE TABLE IF NOT EXISTS calendar_event_exceptions (
        event_id TEXT NOT NULL, occurrence_date TEXT NOT NULL,
        PRIMARY KEY (event_id, occurrence_date)
    )""")

class CalendarInput(BaseModel):
    name: str

@app.get('/api/calendars')
def list_calendars():
    with db_connection() as db:
        return [dict(row) for row in db.execute('SELECT * FROM calendars ORDER BY rowid')]

@app.post('/api/calendars')
def create_calendar(calendar: CalendarInput):
    name = calendar.name.strip()
    if not name or len(name) > 40:
        raise HTTPException(status_code=422, detail='Nombre inválido')
    with db_connection() as db:
        if db.execute('SELECT COUNT(*) FROM calendars').fetchone()[0] >= 4:
            raise HTTPException(status_code=409, detail='Máximo cuatro calendarios')
        cid = str(uuid.uuid4())
        db.execute('INSERT INTO calendars(id,name) VALUES (?,?)', (cid,name))
    return {'id':cid,'name':name}

@app.put('/api/calendars/{calendar_id}')
def rename_calendar(calendar_id: str, calendar: CalendarInput):
    name = calendar.name.strip()
    if not name or len(name) > 40:
        raise HTTPException(status_code=422, detail='Nombre inválido')
    with db_connection() as db:
        result = db.execute('UPDATE calendars SET name=? WHERE id=?', (name, calendar_id))
        if not result.rowcount: raise HTTPException(status_code=404, detail='Calendario inexistente')
    return {'id': calendar_id, 'name': name}

@app.delete('/api/calendars/{calendar_id}')
def delete_calendar(calendar_id: str):
    with db_connection() as db:
        if db.execute('SELECT COUNT(*) FROM calendars').fetchone()[0] <= 1:
            raise HTTPException(status_code=409, detail='No se puede eliminar el último calendario')
        if not db.execute('SELECT 1 FROM calendars WHERE id=?', (calendar_id,)).fetchone():
            raise HTTPException(status_code=404, detail='Calendario inexistente')
        db.execute('DELETE FROM calendar_event_exceptions WHERE event_id IN (SELECT id FROM calendar_events WHERE calendar_id=?)', (calendar_id,))
        db.execute('DELETE FROM calendar_events WHERE calendar_id=?', (calendar_id,))
        db.execute('DELETE FROM calendars WHERE id=?', (calendar_id,))
    return {'ok': True}

class CalendarEventInput(BaseModel):
    date: str
    title: str
    time: str = ''
    notes: str = ''
    color: str = '#22c55e'
    calendar_id: str = 'default'
    recurrence: str = 'none'

def validate_calendar_event(event: CalendarEventInput):
    from datetime import date as date_type
    import re
    try:
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', event.date):
            raise ValueError('Fecha inválida')
        date_type.fromisoformat(event.date)
    except ValueError:
        raise HTTPException(status_code=422, detail='Fecha inválida')
    if not event.title.strip() or len(event.title) > 150:
        raise HTTPException(status_code=422, detail='Título inválido')
    if event.time and not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', event.time):
        raise HTTPException(status_code=422, detail='Hora inválida')
    if not re.fullmatch(r'#[0-9a-fA-F]{6}', event.color):
        raise HTTPException(status_code=422, detail='Color inválido')
    if event.recurrence not in ('none', 'daily', 'weekly', 'monthly'):
        raise HTTPException(status_code=422, detail='Frecuencia inválida')
    if len(event.notes) > 4000:
        raise HTTPException(status_code=422, detail='Notas demasiado largas')

@app.get('/api/calendar/events')
def list_calendar_events():
    with db_connection() as db:
        events = [dict(r) for r in db.execute('SELECT * FROM calendar_events ORDER BY date, time, title')]
        exceptions = {}
        for row in db.execute('SELECT event_id, occurrence_date FROM calendar_event_exceptions'):
            exceptions.setdefault(row['event_id'], []).append(row['occurrence_date'])
        for event in events:
            event['excluded_dates'] = exceptions.get(event['id'], [])
        return events

@app.post('/api/calendar/events')
def create_calendar_event(event: CalendarEventInput):
    validate_calendar_event(event)
    eid = str(uuid.uuid4())
    with db_connection() as db:
        if not db.execute('SELECT 1 FROM calendars WHERE id=?', (event.calendar_id,)).fetchone():
            raise HTTPException(status_code=422, detail='Calendario inexistente')
        db.execute('INSERT INTO calendar_events(id,date,title,time,notes,color,calendar_id,recurrence) VALUES (?,?,?,?,?,?,?,?)', (eid,event.date,event.title.strip(),event.time,event.notes,event.color,event.calendar_id,event.recurrence))
    return {'id': eid}

@app.put('/api/calendar/events/{event_id}')
def update_calendar_event(event_id: str, event: CalendarEventInput):
    validate_calendar_event(event)
    with db_connection() as db:
        result = db.execute('UPDATE calendar_events SET date=?,title=?,time=?,notes=?,color=?,calendar_id=?,recurrence=? WHERE id=?', (event.date,event.title.strip(),event.time,event.notes,event.color,event.calendar_id,event.recurrence,event_id))
        if not result.rowcount:
            raise HTTPException(status_code=404, detail='Evento no encontrado')
    return {'ok': True}

@app.delete('/api/calendar/events/{event_id}')
def delete_calendar_event(event_id: str):
    with db_connection() as db:
        db.execute('DELETE FROM calendar_event_exceptions WHERE event_id=?', (event_id,))
        result = db.execute('DELETE FROM calendar_events WHERE id=?', (event_id,))
        if not result.rowcount:
            raise HTTPException(status_code=404, detail='Evento no encontrado')
    return {'ok': True}

@app.delete('/api/calendar/events/{event_id}/occurrences/{occurrence_date}')
def delete_calendar_occurrence(event_id: str, occurrence_date: str):
    from datetime import date as date_type
    try:
        date_type.fromisoformat(occurrence_date)
    except ValueError:
        raise HTTPException(status_code=422, detail='Fecha inválida')
    with db_connection() as db:
        event = db.execute('SELECT date,recurrence FROM calendar_events WHERE id=?', (event_id,)).fetchone()
        if not event:
            raise HTTPException(status_code=404, detail='Evento inexistente')
        if event['recurrence'] == 'none':
            raise HTTPException(status_code=409, detail='El evento no se repite')
        start = date_type.fromisoformat(event['date'])
        selected = date_type.fromisoformat(occurrence_date)
        delta = (selected - start).days
        recurrence = event['recurrence']
        valid = delta >= 0 and (
            recurrence == 'daily' or
            (recurrence == 'weekly' and delta % 7 == 0) or
            (recurrence == 'monthly' and selected.day == start.day)
        )
        if not valid:
            raise HTTPException(status_code=422, detail='La fecha no corresponde a esta repetición')
        db.execute('INSERT OR IGNORE INTO calendar_event_exceptions(event_id,occurrence_date) VALUES (?,?)', (event_id, occurrence_date))
    return {'ok': True}


class HandwrittenEventText(BaseModel):
    text: str


def parse_calendar_text_local(raw: str):
    """Interpreta fechas explícitas en español sin depender de servicios externos."""
    import unicodedata
    from datetime import date, timedelta

    def plain(value):
        return ''.join(ch for ch in unicodedata.normalize('NFD', value.lower())
                       if unicodedata.category(ch) != 'Mn')

    normalized = plain(raw)
    today = date.today()
    months = {'enero': 1, 'febrero': 2, 'marzo': 3, 'abril': 4, 'mayo': 5,
              'junio': 6, 'julio': 7, 'agosto': 8, 'septiembre': 9,
              'setiembre': 9, 'octubre': 10, 'noviembre': 11, 'diciembre': 12}
    date_match = re.search(r'(?<!\d)(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{2,4}))?(?!\d)', normalized)
    word_match = re.search(r'(?<!\d)(\d{1,2})\s+(?:de\s+)?(' + '|'.join(months) + r')(?:\s+(?:de\s+)?(\d{2,4}))?\b', normalized)
    selected = None
    matched_span = None
    year_inferred = False
    try:
        if date_match:
            day, month = int(date_match.group(1)), int(date_match.group(2))
            year_str = date_match.group(3)
            year_inferred = not bool(year_str)
            year = int(year_str) if year_str else today.year
            if year < 100: year += 2000
            selected = date(year, month, day)
            matched_span = date_match.span()
        elif word_match:
            day, month = int(word_match.group(1)), months[word_match.group(2)]
            year_str = word_match.group(3)
            year_inferred = not bool(year_str)
            year = int(year_str) if year_str else today.year
            if year < 100: year += 2000
            selected = date(year, month, day)
            matched_span = word_match.span()
        elif re.search(r'\bpasado\s+manana\b', normalized):
            selected = today + timedelta(days=2)
            matched_span = re.search(r'\bpasado\s+manana\b', normalized).span()
        elif re.search(r'\bmanana\b', normalized):
            selected = today + timedelta(days=1)
            matched_span = re.search(r'\bmanana\b', normalized).span()
        elif re.search(r'\bhoy\b', normalized):
            selected = today
            matched_span = re.search(r'\bhoy\b', normalized).span()
    except ValueError:
        return None
    if selected is None:
        return None

    # El año ausente se interpreta como el próximo día/mes de esa fecha.
    if year_inferred and selected < today:
        try:
            selected = selected.replace(year=selected.year + 1)
        except ValueError:
            selected = selected.replace(year=selected.year + 1, day=28)

    # Reemplazar solamente la fecha; conservar intacto el título original.
    title = raw[:matched_span[0]] + ' ' + raw[matched_span[1]:]
    clock = re.search(r'(?<!\d)(?:a\s+las?\s+)?([01]?\d|2[0-3])\s*[:.]\s*([0-5]\d)(?:\s*(?:hs?|horas?))?\b', title, re.I)
    if not clock:
        clock = re.search(r'\ba\s+las?\s+([01]?\d|2[0-3])(?:\s*(?:hs?|horas?))?\b', title, re.I)
    time_value = ''
    if clock:
        time_value = f'{int(clock.group(1)):02d}:{int(clock.group(2)) if clock.lastindex and clock.lastindex >= 2 else 0:02d}'
        title = title[:clock.start()] + ' ' + title[clock.end():]
    title = re.sub(r'\s+', ' ', title).strip(' ,.;:-\n\t')
    title = re.sub(r'^(?:fecha\s+importante\s*[:\-]?\s*)', '', title, flags=re.I).strip()
    title = title or 'Evento'
    title = title[0].upper() + title[1:]
    recurrence = 'none'
    for pattern, frequency in ((r'\b(?:todos?\s+los?\s+dias?|diariamente|cada\s+dia)\b', 'daily'),
                               (r'\b(?:semanalmente|cada\s+semana|todas?\s+las?\s+semanas?)\b', 'weekly'),
                               (r'\b(?:mensualmente|cada\s+mes|todos?\s+los?\s+meses)\b', 'monthly')):
        if re.search(pattern, plain(title)):
            recurrence = frequency
            break
    notes = ('Año inferido automáticamente; revisá la fecha antes de guardar.' if year_inferred else '')
    return {'title': title[:150], 'date': selected.isoformat(), 'time': time_value,
            'notes': notes, 'recurrence': recurrence}


@app.post('/api/calendar/parse-handwriting')
def parse_handwritten_calendar_event(payload: HandwrittenEventText):
    """Devuelve un borrador editable sin guardar ni exigir Gemini."""
    from datetime import date
    raw = payload.text.strip()
    if not raw or len(raw) > 4000:
        raise HTTPException(status_code=400, detail='El texto debe tener entre 1 y 4000 caracteres.')
    local = parse_calendar_text_local(raw)
    if local:
        return local
    # Incluso sin fecha reconocible se puede completar el formulario a mano.
    return {'title': raw[:150], 'date': date.today().isoformat(), 'time': '',
            'notes': 'Fecha sugerida: revisala antes de guardar.', 'recurrence': 'none'}


# Register integrations after the base tables and routes have been defined.
from reconocimiento_local.excel_bridge import router as excel_router
from reconocimiento_local.history_api import attach_version_history
from reconocimiento_local.anonymous_users import attach_anonymous_users
from reconocimiento_local.live_sync_api import attach_live_sync

app.include_router(excel_router)
attach_version_history(app, db_connection)
attach_anonymous_users(app, db_connection, DATA_DIR)
attach_live_sync(app, db_connection)
from reconocimiento_local.judge0_api import attach_judge0
attach_judge0(app, DATA_DIR)
from reconocimiento_local.chatgpt_browser import attach_chatgpt_browser
attach_chatgpt_browser(app)

@app.middleware('http')
async def private_response_cache(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith(('/api/', '/recognize/')):
        response.headers['Cache-Control'] = 'private, no-store'
    return response
