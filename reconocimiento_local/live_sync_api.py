"""Notificaciones, participantes presentes y trazos temporales en directo.

La base persistente es la fuente de verdad: solo save_board() confirma los trazos.
El canal no acepta escrituras persistentes ni saltea permisos por pizarra.
SQLite usa un proceso local; PostgreSQL coordina las instancias de Vercel.
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
from collections import deque, OrderedDict
from fastapi import WebSocket, WebSocketDisconnect, Request, HTTPException
from fastapi.responses import JSONResponse
from reconocimiento_local import html_live, cloud_live

# {board_id: {websocket: {uid, client_id, name, color, role, active, points, traffic}}}
_clients: dict[str, dict[WebSocket, dict]] = {}
_locks: dict[WebSocket, asyncio.Lock] = {}
_permission_db = None
_tickets: dict[str, tuple[str, str, float]] = {}
# Estado efímero de reproducción por pizarra/video (no se guarda en SQLite).
_video_states: dict[str, dict[str, dict]] = {}
# Recent acknowledgements survive socket reconnects, without storing geometry.
# Bounded to 64 boards and 4096 stroke identifiers per board.
_ink_resolutions = OrderedDict()


def _remember_ink(board_id, version, saved, removed):
    if cloud_live.enabled():
        cloud_live.remember_ink(board_id,version,saved,removed)
        return
    cache = _ink_resolutions.setdefault(board_id, {})
    _ink_resolutions.move_to_end(board_id)
    for identifiers, deleted in ((saved, False), (removed, True)):
        for identifier in identifiers:
            old = cache.get(identifier)
            if old and old[0] > version:
                continue
            cache.pop(identifier, None)
            cache[identifier] = (version, deleted)
    while len(cache) > 4096:
        cache.pop(next(iter(cache)))
    while len(_ink_resolutions) > 64:
        _ink_resolutions.popitem(last=False)


def _ink_events(board_id):
    if cloud_live.enabled():
        return cloud_live.ink_events(board_id)
    grouped = {}
    for identifier, (version, deleted) in _ink_resolutions.get(board_id, {}).items():
        event = grouped.setdefault(version, {'type': 'ink_settled', 'board_id': board_id,
                                            'version': version, 'saved': [], 'removed': []})
        event['removed' if deleted else 'saved'].append(identifier)
    return list(grouped.values())


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


async def _deliver(board_id: str, value: dict, exclude=None):
    if value.get('type')=='_avatar_changed':
        for participant in _clients.get(board_id,{}).values():
            if participant['uid']==value['user_id']:participant['emoji']=value['emoji']
        await _presence(board_id,publish=False)
        return
    if value.get('type')=='_presence_changed':
        await _presence(board_id,publish=False)
        return
    peers = list(_clients.get(board_id, {}).items())
    for socket, participant in peers:
        if socket is exclude or participant['client_id']==exclude:
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


async def _broadcast(board_id: str, value: dict, *, exclude: WebSocket | None = None):
    excluded=_clients.get(board_id,{}).get(exclude,{}).get('client_id')
    await _deliver(board_id,value,exclude)
    if cloud_live.enabled():
        await cloud_live.publish(board_id,value,excluded)


async def _presence(board_id: str, publish=True):
    peers = _clients.get(board_id, {})
    # Una misma identidad abierta en dos pestañas se presenta una sola vez.
    by_user = {}
    participants=list(cloud_live.peers(board_id) if cloud_live.enabled() else peers.values())
    for participant in participants:
        previous = by_user.get(participant['uid'], {})
        by_user[participant['uid']] = {
            'id': participant['uid'],
            'name': participant['name'],
            'color': participant['color'],
            'emoji': participant['emoji'],
            'view': _active_view(board_id, participant['uid'], participants),
            'client_ids': previous.get('client_ids', []) + [participant['client_id']],
        }
    users = sorted(by_user.values(), key=lambda item: item['name'].casefold())
    for socket, participant in list(peers.items()):
        await _send(socket, {'type': 'presence', 'users': users,
                             'you': participant['uid'], 'board_id': board_id})
    if cloud_live.enabled() and publish:
        await cloud_live.publish(board_id,{'type':'_presence_changed'})


def _active_view(board_id, uid, participants=None):
    if participants is None:
        participants=cloud_live.peers(board_id) if cloud_live.enabled() else _clients.get(board_id,{}).values()
    candidates = [p for p in participants if p['uid'] == uid and p.get('view')]
    return max(candidates, key=lambda p: p.get('view_changed', 0))['view'] if candidates else None


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
        if cloud_live.enabled():cloud_live.ticket_create(token,uid,board_id,now+30)
        else:_tickets[token] = (uid,board_id,now+30)
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
            ticket = cloud_live.ticket_pop(token) if cloud_live.enabled() else _tickets.pop(token,None)
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
            'view': None,
        }
        peers = _clients.setdefault(board_id, {})
        peers[websocket] = participant
        try:
            if cloud_live.enabled():
                await cloud_live.ensure_listener(_deliver)
                cloud_live.register(board_id,participant)
                participant['touch_at']=time.monotonic()
                with db_connection() as db:
                    row=db.execute('SELECT version FROM boards WHERE id=?',(board_id,)).fetchone()
            await _send(websocket, {'type': 'board_version', 'board_id': board_id, 'version': row['version']})
            await _presence(board_id)
            # Quien entra tarde puede unirse al minuto actual sin pedir el estado
            # al resto de participantes. Se limita el tamaño de la memoria.
            video_states=cloud_live.state(board_id,'video',{}) if cloud_live.enabled() else _video_states.get(board_id,{})
            for state in list(video_states.values()):
                await _send(websocket, state)
            for state in html_live.states(board_id):
                await _send(websocket, html_live.public(state))
            for state in _ink_events(board_id):
                await _send(websocket, state)
            while True:
                raw = await websocket.receive_text()
                if len(raw) > 600000:
                    await websocket.close(code=1009)
                    break
                try:
                    payload = json.loads(raw)
                except (json.JSONDecodeError, ValueError):
                    continue
                if not isinstance(payload, dict):
                    continue
                event_type = payload.get('type')
                if len(raw) > 30000 and event_type != 'html_frame':
                    await websocket.close(code=1009)
                    break
                if event_type not in ('stroke_start', 'stroke_points', 'stroke_end', 'stroke_cancel', 'cursor_move', 'cursor_hide', 'video_control', 'camera_move', 'html_start', 'html_stop', 'html_request', 'html_frame', 'html_input'):
                    continue
                if not _allowed(board_id, user_id, 'viewer'):
                    await websocket.close(code=1008)
                    break
                clock = time.monotonic()
                if cloud_live.enabled() and clock-participant.get('touch_at',0)>10:
                    cloud_live.touch(participant['client_id']);participant['touch_at']=clock
                traffic = participant['traffic']
                while traffic and clock - traffic[0] > 1:
                    traffic.popleft()
                traffic.append(clock)
                if len(traffic) > 120:
                    await websocket.close(code=1008)
                    break
                if event_type.startswith('html_'):
                    await html_live.handle(board_id, payload, participant, websocket, db_connection,
                                           _allowed, _send, _broadcast)
                    continue
                if event_type == 'camera_move':
                    center, zoom = _point(payload.get('center')), payload.get('zoom')
                    if (center is None or type(zoom) not in (int, float)
                            or not math.isfinite(zoom) or not 0.01 <= zoom <= 5):
                        continue
                    view = {'center': center, 'zoom': zoom}
                    viewport = payload.get('viewport')
                    if isinstance(viewport, dict):
                        width, height = viewport.get('width'), viewport.get('height')
                        if all(type(v) in (int,float) and math.isfinite(v) and 1 <= v <= 20000 for v in (width,height)):
                            view['viewport'] = {'width': width, 'height': height}
                    following = payload.get('following')
                    if isinstance(following, str) and len(following) <= 80:
                        view['following'] = following
                    if participant.get('view') != view:
                        participant['view_changed'] = clock
                        if cloud_live.enabled():cloud_live.touch(participant['client_id'],view)
                    participant['view'] = view
                    active = _active_view(board_id, user_id)
                    if active != view:
                        continue
                    await _broadcast(board_id, {'type': 'camera_move', 'board_id': board_id,
                                               'user_id': user_id, 'client_id': participant['client_id'],
                                               **view}, exclude=websocket)
                    continue
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
                        html_id, html_action = payload.get('html_id'), payload.get('html_action')
                        if (isinstance(html_id, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,80}', html_id)
                                and html_action in ('pointer', 'interact', 'leave')):
                            outgoing.update(html_id=html_id, html_action=html_action)
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
                    board_states = cloud_live.state(board_id,'video',{}) if cloud_live.enabled() else _video_states.setdefault(board_id,{})
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
                    if cloud_live.enabled():cloud_live.state_save(board_id,'video',board_states)
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
                        await _broadcast(board_id, {'type': 'stroke_interrupted', 'board_id': board_id,
                            'stroke_id': previous, 'client_id': participant['client_id']}, exclude=websocket)
                    participant['active'] = stroke_id
                    participant['points'] = 1
                    forwarded.update(point=start, color=color, width=width, highlighter=payload.get('highlighter') is True)
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
                    if event_type == 'stroke_cancel':
                        with db_connection() as db:
                            current = db.execute('SELECT version FROM boards WHERE id=?', (board_id,)).fetchone()
                        if current:
                            _remember_ink(board_id, current['version'], [], [stroke_id])
                await _broadcast(board_id, forwarded, exclude=websocket)
        except WebSocketDisconnect:
            pass
        except Exception:
            pass
        finally:
            if cloud_live.enabled():
                try:cloud_live.unregister(participant['client_id'])
                except Exception:pass
            await html_live.disconnect(board_id, participant['client_id'], _broadcast)
            if participant['active']:
                await _broadcast(board_id, {'type': 'stroke_interrupted', 'board_id': board_id,
                    'stroke_id': participant['active'], 'client_id': participant['client_id']}, exclude=websocket)
            if participant['client_id']:
                await _broadcast(board_id, {'type':'cursor_hide', 'board_id':board_id,
                    'client_id':participant['client_id']}, exclude=websocket)
            peers.pop(websocket, None)
            _locks.pop(websocket, None)
            if not peers:
                _clients.pop(board_id, None)
                if not cloud_live.enabled() or not cloud_live.peers(board_id):html_live.clear(board_id)
            if peers or cloud_live.enabled():
                await _presence(board_id)
            if cloud_live.enabled() and not _clients:
                await cloud_live.stop_listener()


SCENE_LISTS = ('strokes', 'texts', 'media', 'shapes', 'tables', 'graphs', 'videos')


def apply_scene_removals(current, changes, camera=None):
    """Compact saves can ONLY remove existing IDs; they cannot smuggle assets."""
    if not isinstance(changes,dict) or not changes or any(key not in SCENE_LISTS for key in changes):
        raise HTTPException(422,'Se requieren borrados explícitos.')
    desired=dict(current)
    for key, change in changes.items():
        if (not isinstance(change,dict) or set(change) != {'upsert','remove'} or change['upsert'] != []
                or not isinstance(change['remove'],list) or len(change['remove'])>50000
                or any(not isinstance(identifier,str) or not 1<=len(identifier)<=80 for identifier in change['remove'])):
            raise HTTPException(422,'El guardado compacto sólo permite borrar identificadores.')
        old=current.get(key,(current.get('camera') or {}).get('youtubeVideos',[]) if key=='videos' else [])
        removed=set(change['remove'])
        desired[key]=[item for item in old if item.get('id') not in removed]
    result=apply_scene_changes(current,desired,changes)
    if camera is not None:
        if (set(camera)!={'x','y','zoom'} or any(type(v) not in (int,float) or not math.isfinite(v) for v in camera.values())
                or not .01<=camera['zoom']<=5 or max(abs(camera['x']),abs(camera['y']))>10000000):
            raise HTTPException(422,'Cámara inválida.')
        result['camera']={**result.get('camera',{}),**camera,'youtubeVideos':result['videos']}
    return result


def apply_scene_changes(current: dict, desired: dict, changes: dict):
    """Apply explicit actions; an absent object is not an implicit deletion."""
    if any(key not in SCENE_LISTS for key in changes):
        raise HTTPException(422, 'Lista de cambios desconocida.')
    result = dict(desired)
    for key in SCENE_LISTS:
        camera = current.get('camera') if isinstance(current.get('camera'), dict) else {}
        old = current.get(key, camera.get('youtubeVideos', []) if key == 'videos' else [])
        change = changes.get(key)
        if change is None:
            result[key] = old
            continue
        if not isinstance(change, dict):
            raise HTTPException(422, 'Los cambios de la pizarra no son válidos.')
        upsert, remove, order = change.get('upsert'), change.get('remove'), change.get('order')
        if (not isinstance(upsert, list) or not isinstance(remove, list)
                or any(not isinstance(item, dict) or not isinstance(item.get('id'), str) for item in upsert)
                or any(not isinstance(identifier, str) for identifier in remove)
                or len({item['id'] for item in upsert}) != len(upsert)
                or (order is not None and (not isinstance(order, list)
                    or any(not isinstance(identifier, str) for identifier in order) or len(set(order)) != len(order)))):
            raise HTTPException(422, 'Los identificadores de los cambios no son válidos.')
        requested = desired.get(key, [])
        if not isinstance(requested, list) or any(not isinstance(item, dict) for item in requested):
            raise HTTPException(422, 'La colección modificada no es válida.')
        requested_by_id = {item.get('id'): item for item in requested if isinstance(item.get('id'), str)}
        # Permission middleware validates assets in desired. A patch may never
        # smuggle an additional asset/object that wasn't in that checked body.
        if (any(requested_by_id.get(item['id']) != item for item in upsert)
                or any(identifier in requested_by_id for identifier in remove)
                or (order is not None and order != [item.get('id') for item in requested])):
            raise HTTPException(422, 'Los cambios no coinciden con los objetos enviados.')
        # The first edit of old ink gives it deterministic IDs in the client.
        # Replace only that legacy list, leaving every other collection intact.
        if not isinstance(old, list) or any(not isinstance(item, dict) or not isinstance(item.get('id'), str) for item in old):
            result[key] = desired.get(key, [])
            continue
        items = {item['id']: item for item in old}
        for identifier in remove:
            items.pop(identifier, None)
        for item in upsert:
            items[item['id']] = item
        if order is not None:
            if any(identifier not in items for identifier in order):
                raise HTTPException(422, 'El orden de los objetos no es válido.')
            items = {**{identifier: items[identifier] for identifier in order}, **items}
        result[key] = list(items.values())
    if isinstance(result.get('camera'), dict):
        result['camera'] = {**result['camera'], 'youtubeVideos': result['videos']}
    return result


def scene_patch(before: dict, after: dict):
    patch = {}
    for key in SCENE_LISTS:
        def values(content):
            camera = content.get('camera')
            return content.get(key, camera.get('youtubeVideos', []) if key == 'videos' and isinstance(camera, dict) else [])
        old, new = values(before), values(after)
        if old == new:
            continue
        if not isinstance(old, list) or not isinstance(new, list):
            return None
        if any(not isinstance(item, dict) or not isinstance(item.get('id'), str) for item in old + new):
            return None  # Legacy ink without IDs uses the snapshot fallback.
        previous = {item['id']: item for item in old}
        current = {item['id']: item for item in new}
        if len(previous) != len(old) or len(current) != len(new):
            return None
        # Reordering changes stacking; preserve it through a full snapshot.
        retained = [item['id'] for item in old if item['id'] in current]
        appended = [item['id'] for item in new if item['id'] not in previous]
        if retained + appended != [item['id'] for item in new]:
            return None
        patch[key] = {'upsert': [item for item in new if previous.get(item['id']) != item],
                      'remove': [item['id'] for item in old if item['id'] not in current]}
    return patch if len(json.dumps(patch, ensure_ascii=False).encode('utf-8')) <= 512_000 else None


async def notify_board_saved(board_id: str, version: int, before=None, after=None, discarded_strokes=()):
    if not cloud_live.enabled() and board_id not in _clients and board_id not in _ink_resolutions and not discarded_strokes:
        return
    event = {'type': 'board_version', 'board_id': board_id, 'version': version}
    settled = None
    if isinstance(before, dict) and isinstance(after, dict):
        deletions={}
        for key in SCENE_LISTS:
            previous=before.get(key,(before.get('camera') or {}).get('youtubeVideos',[]) if key=='videos' else [])
            current=after.get(key,(after.get('camera') or {}).get('youtubeVideos',[]) if key=='videos' else [])
            present={item.get('id') for item in current if isinstance(item,dict)}
            removed_ids=[item['id'] for item in previous if isinstance(item,dict) and isinstance(item.get('id'),str) and item['id'] not in present]
            if removed_ids:deletions[key]=removed_ids
        if discarded_strokes:
            deletions['strokes']=list(dict.fromkeys([*deletions.get('strokes', []), *discarded_strokes]))
        if deletions:event['deletions']=deletions
        old = {stroke['id']: stroke for stroke in before.get('strokes', [])
               if isinstance(stroke, dict) and isinstance(stroke.get('id'), str)}
        new = {stroke['id']: stroke for stroke in after.get('strokes', [])
               if isinstance(stroke, dict) and isinstance(stroke.get('id'), str)}
        saved = [identifier for identifier, stroke in new.items() if old.get(identifier) != stroke]
        # Live ink may have been drawn and erased between two saves. The before
        # and after snapshots alone cannot describe that removal to observers.
        removed = list(dict.fromkeys([*[identifier for identifier in old if identifier not in new],
                                      *discarded_strokes]))
        if saved or removed:
            if cloud_live.enabled():
                await asyncio.to_thread(_remember_ink,board_id,version,saved,removed)
            else:
                _remember_ink(board_id, version, saved, removed)
            settled = {'type': 'ink_settled', 'board_id': board_id, 'version': version,
                       'saved': saved, 'removed': removed}
        patch = scene_patch(before, after)
        if patch is not None:
            event.update(base_version=version-1, patch=patch)
    await _broadcast(board_id, event)
    if settled:
        await _broadcast(board_id, settled)
    await _presence(board_id)  # Retira participantes cuya invitación fue revocada.


async def notify_avatar_changed(user_id: str, emoji: str):
    """Actualiza el emoji en todas las conexiones y listas de participantes."""
    if cloud_live.enabled():
        for board_id in cloud_live.avatar(user_id,emoji):
            await _deliver(board_id,{'type':'_avatar_changed','user_id':user_id,'emoji':emoji})
            await cloud_live.publish(board_id,{'type':'_avatar_changed','user_id':user_id,'emoji':emoji})
        return
    for board_id, peers in list(_clients.items()):
        changed = False
        for participant in peers.values():
            if participant['uid'] == user_id:
                participant['emoji'] = emoji
                changed = True
        if changed:
            await _presence(board_id)
