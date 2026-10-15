"""Bounded, ephemeral HTML sessions: one executor, inert views and UI input."""
import json
import math
import re
import time

_states = {}
_ID = re.compile(r'[A-Za-z0-9_-]{1,80}')


def states(board_id):
    return list(_states.get(board_id, {}).values())


def public(state, kind='html_state', **extra):
    return {key: value for key, value in state.items() if not key.startswith('_')} | {'type': kind} | extra


def clear(board_id):
    _states.pop(board_id, None)


async def disconnect(board_id, client_id, broadcast):
    for state in states(board_id):
        if state['owner_id'] == client_id and state['running']:
            state['running'] = False
            await broadcast(board_id, public(state, 'html_stop'))


async def handle(board_id, payload, participant, socket, db_connection, allowed, send, broadcast):
    identifier = payload.get('html_id')
    if not isinstance(identifier, str) or not _ID.fullmatch(identifier):
        return
    kind = payload['type']
    cache = _states.setdefault(board_id, {})
    state = cache.get(identifier)
    if kind == 'html_request':
        if state:
            await send(socket, public(state))
        return
    if not allowed(board_id, participant['uid'], 'editor'):
        return
    if kind == 'html_start':
        request = payload.get('request')
        if not isinstance(request, str) or not _ID.fullmatch(request):
            return
        if state and state['running']:
            await send(socket, public(state, request=request))
            return
        with db_connection() as db:
            board = db.execute('SELECT content FROM boards WHERE id=?', (board_id,)).fetchone()
        try:
            found = any(item.get('id') == identifier and item.get('visualType') == 'html'
                        for item in json.loads(board['content']).get('shapes', []))
        except (ValueError, TypeError, AttributeError):
            return
        if not found:
            await send(socket, {'type': 'html_error', 'html_id': identifier, 'board_id': board_id,
                                'retry': True, 'error': 'Esperando que termine de guardarse el HTML…'})
            return
        if identifier not in cache and len(cache) >= 10:
            inactive = next((key for key, value in cache.items() if not value['running']), None)
            if inactive is None:
                await send(socket, {'type': 'html_error', 'html_id': identifier, 'board_id': board_id,
                                    'error': 'Ya hay diez HTML activos. Detené uno para activar otro.'})
                return
            cache.pop(inactive)
        state = {'html_id': identifier, 'board_id': board_id, 'session': request,
                 'owner_id': participant['client_id'], 'name': participant['name'],
                 'running': True, 'document': '', 'revision': 0, '_at': 0}
        cache[identifier] = state
        await broadcast(board_id, public(state, 'html_session', request=request))
        return
    if not state or not state['running'] or payload.get('session') != state['session']:
        return
    owner = state['owner_id'] == participant['client_id']
    if kind == 'html_input':
        event = payload.get('event')
        if owner or not isinstance(event, dict):
            return
        action, node = event.get('action'), event.get('node')
        if action not in ('click', 'pointerdown', 'pointerup', 'pointermove', 'input', 'change', 'keydown', 'keyup', 'scroll'):
            return
        if not isinstance(node, str) or not re.fullmatch(r'[0-9]{1,8}', node):
            return
        clean = {'action': action, 'node': node}
        for key, limit in [('value', 8000), ('key', 80), ('code', 80), ('pointerType', 10)]:
            if key in event:
                if not isinstance(event[key], str) or len(event[key]) > limit:
                    return
                clean[key] = event[key]
        for key in ('x', 'y', 'left', 'top', 'button', 'buttons'):
            if key in event:
                value = event[key]
                if type(value) not in (int, float) or not math.isfinite(value) or abs(value) > 1000000:
                    return
                clean[key] = value
        for key in ('checked', 'ctrlKey', 'shiftKey', 'altKey'):
            if key in event and type(event[key]) is bool:
                clean[key] = event[key]
        await broadcast(board_id, {'type': 'html_input', 'board_id': board_id, 'html_id': identifier,
                                   'session': state['session'], 'event': clean}, exclude=socket)
        return
    if kind == 'html_stop':
        state['running'] = False
        await broadcast(board_id, public(state, 'html_stop'))
        return
    if not owner:
        return
    if kind == 'html_frame':
        now = time.monotonic()
        if now - state['_at'] < .20:
            return
        before = state['document']
        if payload.get('base') != state['revision']:
            await send(socket, {'type': 'html_resync', 'board_id': board_id, 'html_id': identifier,
                                'session': state['session'], 'revision': state['revision']})
            return
        prefix, remove, text = payload.get('prefix'), payload.get('remove'), payload.get('text')
        if (type(prefix) is not int or type(remove) is not int or not isinstance(text, str)
                or not 0 <= prefix <= len(before) or not 0 <= remove <= len(before)-prefix):
            return
        document = before[:prefix] + text + before[prefix+remove:]
        if len(document) > 500000:
            return
        state.update(document=document, revision=state['revision']+1, _at=now)
        await broadcast(board_id, {'type': 'html_patch', 'board_id': board_id, 'html_id': identifier,
                                   'session': state['session'], 'base': state['revision']-1,
                                   'revision': state['revision'], 'prefix': prefix, 'remove': remove,
                                   'text': text}, exclude=socket)
