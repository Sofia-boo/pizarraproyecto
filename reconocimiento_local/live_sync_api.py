"""Notificaciones, participantes presentes y trazos temporales en directo.

SQLite sigue siendo la fuente de verdad: solo save_board() confirma los trazos.
El canal no acepta escrituras persistentes ni saltea permisos por pizarra.
Diseñado para un proceso Uvicorn (workers=1) y grupos pequeños.
"""
from __future__ import annotations

import asyncio
import json
import math
import re
import time
import uuid
import os
import secrets
from urllib.parse import urlsplit, quote
from collections import deque
from fastapi import WebSocket, WebSocketDisconnect, Request, HTTPException
from fastapi.responses import JSONResponse

# {board_id: {websocket: {uid, client_id, name, color, role, active, points, traffic}}}
_clients: dict[str, dict[WebSocket, dict]] = {}
_locks: dict[WebSocket, asyncio.Lock] = {}
_permission_db = None
_tickets: dict[str, tuple[str, str, float]] = {}
# Estado efímero de reproducción por pizarra/video (no se guarda en SQLite).
_video_states: dict[str, dict[str, dict]] = {}


def _allowed(board_id: str, user_id: str, level: str = 'viewer') -> bool:
    from reconocimiento_local.anonymous_users import can_board
    if _permission_db is None:
        return False
    with _permission_db() as db:
        return can_board(db, user_id, board_id, level)


def _point(item):
    if not isinstance(item, dict):
        return None
    x, y = item.get('x'), item.get('y')
    if type(x) not in (int, float) or type(y) not in (int, float):
        return None
    if not math.isfinite(x) or not math.isfinite(y) or max(abs(x), abs(y)) > 10_000_000:
        return None
    return {'x': x, 'y': y}


async def _send(socket: WebSocket, value: dict) -> bool:
    try:
        async with _locks.setdefault(socket, asyncio.Lock()):
            await socket.send_json(value)
        return True
    except Exception:
        return False


async def _broadcast(board_id: str, value: dict, *, exclude: WebSocket | None = None):
    peers = list(_clients.get(board_id, {}).items())
    for socket, participant in peers:
        if socket is exclude:
            continue
        if not _allowed(board_id, participant['uid']):
            _clients.get(board_id, {}).pop(socket, None)
            try:
                await socket.close(code=1008)
            except Exception:
                pass
            continue
        if not await _send(socket, value):
            _clients.get(board_id, {}).pop(socket, None)


async def _presence(board_id: str):
    peers = _clients.get(board_id, {})
    # Una misma identidad abierta en dos pestañas se presenta una sola vez.
    by_user = {}
    for participant in peers.values():
        by_user[participant['uid']] = {
            'id': participant['uid'],
            'name': participant['name'],
            'color': participant['color'],
            'emoji': participant['emoji'],
        }
    users = sorted(by_user.values(), key=lambda item: item['name'].casefold())
    for socket, participant in list(peers.items()):
        await _send(socket, {'type': 'presence', 'users': users,
                             'you': participant['uid'], 'board_id': board_id})


def attach_live_sync(app, db_connection):
    global _permission_db
    _permission_db = db_connection

    @app.get('/api/boards/{board_id}/live-ticket')
    async def live_ticket(request: Request, board_id: str):
        from reconocimiento_local.anonymous_users import find_user, COOKIE, can_board
        with db_connection() as db:
            user = find_user(db, request.cookies.get(COOKIE))
            if not user or not can_board(db,user['id'],board_id):
                raise HTTPException(403,'Sin permisos para esta pizarra')
            uid = user['id']
        now = time.monotonic()
        for token, (owner, bid, expires) in list(_tickets.items()):
            if expires < now or (owner == uid and bid == board_id):
                _tickets.pop(token,None)
        if len(_tickets) >= 2048:
            raise HTTPException(429,'Demasiadas conexiones pendientes')
        token = secrets.token_urlsafe(32)
        _tickets[token] = (uid,board_id,now+30)
        origin = urlsplit(os.environ.get('PIZARRA_WS_ORIGIN') or str(request.base_url))
        if origin.scheme not in ('http','https') or not origin.netloc:
            raise HTTPException(503,'Conexión en vivo sin configurar')
        scheme = 'wss' if origin.scheme=='https' else 'ws'
        return JSONResponse({'url':f'{scheme}://{origin.netloc}/api/live/{quote(board_id,safe="")}?ticket={token}'},
                            headers={'Cache-Control':'private, no-store'})

    @app.websocket('/api/live/{board_id}')
    async def board_live(websocket: WebSocket, board_id: str):
        from reconocimiento_local.anonymous_users import websocket_allowed, board_role
        token = websocket.query_params.get('ticket')
        ticket_uid = None
        if token:
            ticket = _tickets.pop(token,None)
            if not ticket or ticket[1] != board_id or ticket[2] < time.monotonic():
                await websocket.close(code=1008)
                return
            ticket_uid = ticket[0]
        allowed, user_id = websocket_allowed(websocket, board_id, db_connection, ticket_uid)
        if not allowed or user_id is None:
            await websocket.close(code=1008)
            return
        with db_connection() as db:
            row = db.execute('SELECT version FROM boards WHERE id=?', (board_id,)).fetchone()
            profile = db.execute('SELECT display_name,color,emoji FROM anonymous_users WHERE id=?', (user_id,)).fetchone()
            role = board_role(db, user_id, board_id)
        if row is None or profile is None:
            await websocket.close(code=1008)
            return
        await websocket.accept()
        participant = {
            'uid': user_id,
            'client_id': uuid.uuid4().hex,
            'name': profile['display_name'],
            'emoji': profile['emoji'] or '🙂',
            'color': profile['color'] if re.fullmatch(r'#[0-9a-fA-F]{6}', profile['color']) else '#6366f1',
            'role': role,
            'active': None,
            'points': 0,
            'traffic': deque(),
        }
        peers = _clients.setdefault(board_id, {})
        peers[websocket] = participant
        try:
            await _send(websocket, {'type': 'board_version', 'board_id': board_id, 'version': row['version']})
            await _presence(board_id)
            # Quien entra tarde puede unirse al minuto actual sin pedir el estado
            # al resto de participantes. Se limita el tamaño de la memoria.
            for state in list(_video_states.get(board_id, {}).values()):
                await _send(websocket, state)
            while True:
                raw = await websocket.receive_text()
                if len(raw) > 30000:
                    await websocket.close(code=1009)
                    break
                try:
                    payload = json.loads(raw)
                except (json.JSONDecodeError, ValueError):
                    continue
                if not isinstance(payload, dict):
                    continue
                event_type = payload.get('type')
                if event_type not in ('stroke_start', 'stroke_points', 'stroke_end', 'stroke_cancel', 'cursor_move', 'cursor_hide', 'video_control'):
                    continue
                if not _allowed(board_id, user_id, 'viewer'):
                    await websocket.close(code=1008)
                    break
                clock = time.monotonic()
                traffic = participant['traffic']
                while traffic and clock - traffic[0] > 1:
                    traffic.popleft()
                traffic.append(clock)
                if len(traffic) > 120:
                    await websocket.close(code=1008)
                    break
                if event_type in ('cursor_move', 'cursor_hide'):
                    # Los lectores pueden mostrar cursor, pero nunca dibujar.
                    outgoing = {'type': event_type, 'board_id': board_id,
                                'client_id': participant['client_id'], 'user_id': participant['uid'],
                                'name': participant['name'], 'color': participant['color'],
                                'emoji': participant['emoji']}
                    if event_type == 'cursor_move':
                        position = _point(payload.get('point'))
                        if position is None:
                            continue
                        outgoing['point'] = position
                    await _broadcast(board_id, outgoing, exclude=websocket)
                    continue
                if not _allowed(board_id, user_id, 'editor'):
                    if event_type == 'video_control':
                        # La reproducción compartida es de solo lectura para un espectador.
                        # Ignorar el control, pero conservar la conexión para presencia.
                        continue
                    await websocket.close(code=1008)
                    break
                if event_type == 'video_control':
                    # Solo se permiten operaciones acotadas sobre un video de la
                    # pizarra; nunca se retransmite JSON ni URLs arbitrarias.
                    video_id = payload.get('video_id')
                    action = payload.get('action')
                    position = payload.get('position')
                    if (not isinstance(video_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', video_id)
                            or action not in ('play', 'pause', 'seek', 'position', 'range')
                            or type(position) not in (int, float) or not math.isfinite(position)
                            or not 0 <= position <= 86400):
                        continue
                    # Validar que el objeto existe y es un video compartido:
                    # impide emitir controles para identificadores inexistentes.
                    with db_connection() as db:
                        board = db.execute('SELECT content FROM boards WHERE id=?', (board_id,)).fetchone()
                    if board is None:
                        continue
                    try:
                        content = json.loads(board['content'])
                        camera = content.get('camera') or {}
                        videos = camera.get('youtubeVideos', content.get('videos', []))
                        found = next((v for v in videos if isinstance(v, dict) and v.get('id') == video_id), None)
                    except (ValueError, TypeError, AttributeError):
                        continue
                    if found is None:
                        continue
                    board_states = _video_states.setdefault(board_id, {})
                    if video_id not in board_states and len(board_states) >= 30:
                        # Acotar memoria de las pizarras con múltiples videos.
                        board_states.pop(next(iter(board_states)))
                    prev = board_states.get(video_id, {})
                    start = prev.get('start', found.get('start') or 0)
                    end = prev.get('end', found.get('end'))
                    if action == 'range':
                        start, end = payload.get('start'), payload.get('end')
                        if (type(start) not in (int, float) or not math.isfinite(start) or
                                not 0 <= start <= 86400 or
                                (end is not None and (type(end) not in (int, float) or
                                 not math.isfinite(end) or not start < end <= 86400))):
                            continue
                    playing = (action == 'play' if action in ('play', 'pause')
                               else prev.get('playing', False))
                    if action == 'range':
                        playing = False
                        position = start
                    if end is not None and position > end:
                        position = end
                        playing = False
                    if position < start:
                        position = start
                    state = {'type': 'video_state', 'board_id': board_id,
                             'video_id': video_id, 'position': position,
                             'playing': playing, 'start': start, 'end': end,
                             'at': time.time(), 'client_id': participant['client_id']}
                    board_states[video_id] = state
                    await _broadcast(board_id, state, exclude=websocket)
                    continue
                stroke_id = payload.get('stroke_id')
                if not isinstance(stroke_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', stroke_id):
                    continue
                forwarded = {'type': event_type, 'board_id': board_id,
                             'stroke_id': stroke_id, 'client_id': participant['client_id']}
                if event_type == 'stroke_start':
                    start = _point(payload.get('point'))
                    color = payload.get('color')
                    width = payload.get('width')
                    if (start is None or not isinstance(color, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', color)
                            or type(width) not in (float, int) or not math.isfinite(width) or not 0.1 <= width <= 100):
                        continue
                    # Un mismo cliente solamente puede mantener un trazo abierto.
                    previous = participant['active']
                    if previous:
                        await _broadcast(board_id, {'type': 'stroke_cancel', 'board_id': board_id,
                            'stroke_id': previous, 'client_id': participant['client_id']}, exclude=websocket)
                    participant['active'] = stroke_id
                    participant['points'] = 1
                    forwarded.update(point=start, color=color, width=width)
                elif participant['active'] != stroke_id:
                    continue
                elif event_type == 'stroke_points':
                    batch = payload.get('points')
                    if not isinstance(batch, list) or not 1 <= len(batch) <= 80:
                        continue
                    pts = [_point(item) for item in batch]
                    if any(p is None for p in pts) or participant['points'] + len(pts) > 25000:
                        continue
                    participant['points'] += len(pts)
                    forwarded['points'] = pts
                else:
                    participant['active'] = None
                    participant['points'] = 0
                await _broadcast(board_id, forwarded, exclude=websocket)
        except WebSocketDisconnect:
            pass
        except Exception:
            pass
        finally:
            if participant['active']:
                await _broadcast(board_id, {'type': 'stroke_cancel', 'board_id': board_id,
                    'stroke_id': participant['active'], 'client_id': participant['client_id']}, exclude=websocket)
            if participant['client_id']:
                await _broadcast(board_id, {'type':'cursor_hide', 'board_id':board_id,
                    'client_id':participant['client_id']}, exclude=websocket)
            peers.pop(websocket, None)
            _locks.pop(websocket, None)
            if not peers:
                _clients.pop(board_id, None)
            else:
                await _presence(board_id)


async def notify_board_saved(board_id: str, version: int):
    if board_id not in _clients:
        return
    await _broadcast(board_id, {'type': 'board_version', 'board_id': board_id, 'version': version})
    await _presence(board_id)  # Retira participantes cuya invitación fue revocada.


async def notify_avatar_changed(user_id: str, emoji: str):
    """Actualiza el emoji en todas las conexiones y listas de participantes."""
    for board_id, peers in list(_clients.items()):
        changed = False
        for participant in peers.values():
            if participant['uid'] == user_id:
                participant['emoji'] = emoji
                changed = True
        if changed:
            await _presence(board_id)
