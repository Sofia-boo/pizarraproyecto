"""Historial de versiones local por pizarra.

Instalación: importar attach_version_history al FINAL de server.py y llamarla
pasando app y db_connection. No modifica las rutas existentes ni el formato
actual de las pizarras. Los snapshots contienen referencias a assets, no blobs.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Callable

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

AUTO_INTERVAL_MINUTES = 5 * 60
AUTO_KEEP_PER_BOARD = 40


class ManualVersionInput(BaseModel):
    title: str = Field(default='', max_length=120)
    expected_version: int | None = Field(default=None, ge=0)


class RestoreVersionInput(BaseModel):
    expected_version: int | None = Field(default=None, ge=0)


def attach_version_history(app, db_connection: Callable):
    """Añade rutas + migración y trigger automático, sin tocar save_board()."""
    if getattr(app.state, 'board_history_attached', False):
        return

    from reconocimiento_local.cloud_database import enabled
    if not enabled():
        with db_connection() as db:
            db.executescript(f"""
            CREATE TABLE IF NOT EXISTS board_history (
              id TEXT PRIMARY KEY,
              board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
              board_version INTEGER NOT NULL,
              kind TEXT NOT NULL CHECK(kind IN ('auto','manual','safety')),
              title TEXT NOT NULL DEFAULT '',
              content TEXT NOT NULL,
              size_bytes INTEGER NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_board_history_by_board
              ON board_history(board_id, created_at DESC);
            -- Reinstalar el trigger para actualizar instalaciones que usaban 5 minutos.
            DROP TRIGGER IF EXISTS trg_board_history_on_content_change;
            CREATE TRIGGER trg_board_history_on_content_change
            AFTER UPDATE OF content ON boards
            WHEN (CASE WHEN json_valid(NEW.content) AND json_valid(OLD.content)
                THEN json_remove(NEW.content, '$.camera') != json_remove(OLD.content, '$.camera')
                ELSE NEW.content != OLD.content END) AND (
              NOT EXISTS (
                SELECT 1 FROM board_history
                  WHERE board_id = NEW.id AND kind='auto'
              )
              OR (julianday('now') - (
                SELECT MAX(julianday(created_at)) FROM board_history
                 WHERE board_id = NEW.id AND kind='auto'
              )) * 1440 >= {AUTO_INTERVAL_MINUTES}
            )
            BEGIN
              INSERT INTO board_history
                (id, board_id, board_version, kind, title, content, size_bytes, created_at)
              VALUES
                (lower(hex(randomblob(16))), NEW.id, NEW.version, 'auto', '',
                 NEW.content, length(CAST(NEW.content AS BLOB)),
                 strftime('%Y-%m-%dT%H:%M:%fZ','now'));
              DELETE FROM board_history WHERE id IN (
                SELECT id FROM board_history
                 WHERE board_id=NEW.id AND kind='auto'
                 ORDER BY created_at DESC, rowid DESC
                 LIMIT -1 OFFSET {AUTO_KEEP_PER_BOARD}
              );
            END;
            """)

    router = APIRouter(prefix='/api/boards/{board_id}/history', tags=['board-history'])

    def get_board(db, board_id: str):
        row = db.execute('SELECT id, version, content FROM boards WHERE id=?', (board_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail='Pizarra inexistente')
        return row

    def get_version(db, board_id: str, snapshot_id: str):
        row = db.execute('SELECT * FROM board_history WHERE board_id=? AND id=?', (board_id, snapshot_id)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail='Versión inexistente en esta pizarra')
        return row

    def check_version(board, expected: int | None):
        if expected is not None and board['version'] != expected:
            raise HTTPException(status_code=409, detail='La pizarra cambió en otra pestaña. Recargá el historial antes de continuar.')

    def create_snapshot(db, board_id: str, board_version: int, content: str, kind: str, title: str = ''):
        snapshot_id = uuid.uuid4().hex
        now = datetime.now(timezone.utc).isoformat()
        db.execute('''INSERT INTO board_history
          (id,board_id,board_version,kind,title,content,size_bytes,created_at)
          VALUES(?,?,?,?,?,?,?,?)''',
          (snapshot_id, board_id, board_version, kind, title[:120], content,
           len(content.encode('utf-8')), now))
        return snapshot_id

    def as_metadata(row):
        return {key: row[key] for key in ('id', 'board_version', 'kind', 'title', 'created_at', 'size_bytes')}

    @router.get('')
    def list_versions(board_id: str):
        with db_connection() as db:
            board = get_board(db, board_id)
            rows = db.execute('''SELECT id,board_version,kind,title,created_at,size_bytes
              FROM board_history WHERE board_id=?
              ORDER BY created_at DESC, rowid DESC LIMIT 300''', (board_id,)).fetchall()
        return {'board_id': board_id, 'current_version': board['version'],
                'history': [as_metadata(row) for row in rows],
                'auto_interval_minutes': AUTO_INTERVAL_MINUTES,
                'auto_keep': AUTO_KEEP_PER_BOARD}

    @router.post('', status_code=201)
    def add_manual_version(board_id: str, item: ManualVersionInput):
        with db_connection() as db:
            board = get_board(db, board_id)
            check_version(board, item.expected_version)
            snapshot_id = create_snapshot(db, board_id, board['version'], board['content'],
                                          'manual', item.title.strip() or 'Versión guardada')
        return {'id': snapshot_id, 'board_version': board['version']}

    @router.get('/{snapshot_id}')
    def preview_version(board_id: str, snapshot_id: str):
        with db_connection() as db:
            get_board(db, board_id)
            snapshot = get_version(db, board_id, snapshot_id)
            raw_content = snapshot['content']
        try:
            content = json.loads(raw_content)
        except (TypeError, json.JSONDecodeError):
            raise HTTPException(status_code=500, detail='Esta versión tiene datos dañados')
        return {**as_metadata(snapshot), 'content': content}

    @router.post('/{snapshot_id}/restore')
    async def restore_version(board_id: str, snapshot_id: str, item: RestoreVersionInput):
        with db_connection() as db:
            board = get_board(db, board_id)
            check_version(board, item.expected_version)
            snapshot = get_version(db, board_id, snapshot_id)
            # No pisar el estado actual sin un punto de recuperación.
            safety_id = create_snapshot(db, board_id, board['version'], board['content'],
                                        'safety', 'Antes de restaurar')
            version = board['version'] + 1
            changed = db.execute('''UPDATE boards SET content=?, version=?, updated_at=?
              WHERE id=? AND version=?''', (snapshot['content'], version,
                             datetime.now(timezone.utc).isoformat(), board_id, board['version']))
            if not changed.rowcount:
                raise HTTPException(409, 'La pizarra cambio durante la restauracion.')
            content=json.loads(snapshot['content'])
            db.execute('DELETE FROM board_assets WHERE board_id=?',(board_id,))
            for media in content.get('media',[]):
                if isinstance(media,dict) and isinstance(media.get('assetId'),str):
                    db.execute('INSERT OR IGNORE INTO board_assets VALUES (?,?)',(board_id,media['assetId']))
        from reconocimiento_local.live_sync_api import notify_board_saved
        await notify_board_saved(board_id,version,json.loads(board['content']),content)
        return {'ok': True, 'new_version': version, 'safety_snapshot_id': safety_id}

    @router.delete('/{snapshot_id}')
    def delete_version(board_id: str, snapshot_id: str):
        with db_connection() as db:
            get_board(db, board_id)
            result = db.execute('DELETE FROM board_history WHERE board_id=? AND id=?',
                                (board_id, snapshot_id))
            if not result.rowcount:
                raise HTTPException(status_code=404, detail='Versión inexistente')
        return {'ok': True}

    @router.delete('')
    def delete_all_versions(board_id: str):
        with db_connection() as db:
            get_board(db, board_id)
            result = db.execute('DELETE FROM board_history WHERE board_id=?', (board_id,))
        return {'ok': True, 'removed': result.rowcount}

    app.include_router(router)
    app.state.board_history_attached = True
