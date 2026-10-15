"""Postgres coordination for Vercel instances; no home-PC relay or paid broker."""
import asyncio
import json
import os
import time
import uuid
import logging
from contextlib import contextmanager
from reconocimiento_local import cloud_database as database

NODE = uuid.uuid4().hex
_listeners = {}
_last_cleanup = 0
logger = logging.getLogger(__name__)


def enabled():
    return database.enabled()


def ticket_create(token, user, board, expires):
    with database.connection() as db:
        db.execute('DELETE FROM pizarra_live_tickets WHERE expires<?', (time.time(),))
        db.execute('INSERT INTO pizarra_live_tickets VALUES (?,?,?,?)', (token, user, board, time.time()+30))


def ticket_pop(token):
    with database.connection() as db:
        row=db.execute('DELETE FROM pizarra_live_tickets WHERE token=? RETURNING user_id,board_id,expires',(token,)).fetchone()
    if not row or row['expires']<time.time():return None
    return row['user_id'],row['board_id'],time.monotonic()+30


def register(board, profile):
    clean={key:profile[key] for key in ('uid','client_id','name','color','emoji','role')}
    with database.connection() as db:
        db.execute('INSERT INTO pizarra_live_peers(client_id,board_id,node_id,profile,seen) VALUES(?,?,?,?,?)',
                   (profile['client_id'],board,NODE,json.dumps(clean),time.time()))


def unregister(client):
    with database.connection() as db:
        db.execute('DELETE FROM pizarra_live_peers WHERE client_id=?',(client,))


def avatar(user,emoji):
    with database.connection() as db:
        rows=db.execute('''UPDATE pizarra_live_peers SET profile=jsonb_set(profile::jsonb,'{emoji}',to_jsonb(?::text))::text
          WHERE profile::jsonb->>'uid'=? RETURNING board_id''',(emoji,user)).fetchall()
    return {row['board_id'] for row in rows}


def touch(client, view=None):
    with database.connection() as db:
        if view is None:
            db.execute('UPDATE pizarra_live_peers SET seen=? WHERE client_id=?',(time.time(),client))
        else:
            db.execute('UPDATE pizarra_live_peers SET view=?,changed=?,seen=? WHERE client_id=?',
                       (json.dumps(view),time.time(),time.time(),client))


def peers(board):
    with database.connection() as db:
        rows=db.execute('SELECT profile,view,changed FROM pizarra_live_peers WHERE board_id=? AND seen>?',
                        (board,time.time()-45)).fetchall()
    return [{**json.loads(row['profile']),'view':json.loads(row['view']) if row['view'] else None,
             'view_changed':row['changed']} for row in rows]


def state(board,kind,default=None):
    with database.connection() as db:
        row=db.execute('SELECT value FROM pizarra_live_state WHERE board_id=? AND kind=?',(board,kind)).fetchone()
    return json.loads(row['value']) if row else default


def state_save(board,kind,value):
    with database.connection() as db:
        db.execute('INSERT INTO pizarra_live_state VALUES(?,?,?) ON CONFLICT(board_id,kind) DO UPDATE SET value=excluded.value',
                   (board,kind,json.dumps(value,ensure_ascii=False)))


def remember_ink(board,version,saved,removed):
    with database.connection() as db:
        for identifiers,deleted in ((saved,False),(removed,True)):
            for identifier in identifiers:
                db.execute('''INSERT INTO pizarra_live_ink VALUES(?,?,?,?,?) ON CONFLICT(board_id,stroke_id)
                  DO UPDATE SET version=excluded.version,removed=excluded.removed,updated=excluded.updated
                  WHERE pizarra_live_ink.version<=excluded.version''',(board,identifier,version,deleted,time.time()))
        db.execute('''DELETE FROM pizarra_live_ink WHERE board_id=? AND stroke_id IN
          (SELECT stroke_id FROM pizarra_live_ink WHERE board_id=? ORDER BY updated DESC OFFSET 4096)''',(board,board))


def ink_events(board):
    with database.connection() as db:
        rows=db.execute('SELECT stroke_id,version,removed FROM pizarra_live_ink WHERE board_id=? ORDER BY version',(board,)).fetchall()
    grouped={}
    for row in rows:
        event=grouped.setdefault(row['version'],{'type':'ink_settled','board_id':board,'version':row['version'],'saved':[],'removed':[]})
        event['removed' if row['removed'] else 'saved'].append(row['stroke_id'])
    return list(grouped.values())


def _publish(board,value,exclude):
    global _last_cleanup
    with database.connection() as db:
        # Event IDs must follow commit order so reconnect replay cannot skip
        # an earlier, slower transaction.
        db.execute('SELECT pg_advisory_xact_lock(73492183)')
        event={**value,'_node':NODE,'_exclude':exclude}
        identifier=db.execute('INSERT INTO pizarra_live_events(board_id,payload,created_at) VALUES(?,?,?) RETURNING id',
                              (board,json.dumps(event,ensure_ascii=False),time.time())).fetchone()[0]
        db.execute("SELECT pg_notify('pizarra_live',?)",(str(identifier),))
        if time.monotonic()-_last_cleanup>30:
            _last_cleanup=time.monotonic()
            db.execute('DELETE FROM pizarra_live_events WHERE created_at<?',(time.time()-120,))
            db.execute('DELETE FROM pizarra_live_peers WHERE seen<?',(time.time()-45,))
            db.execute('DELETE FROM pizarra_rate WHERE expires<?',(time.time()-900,))
            db.execute('DELETE FROM pizarra_asset_uploads WHERE updated<?',(time.time()-3600,))


async def publish(board,value,exclude=None):
    await asyncio.to_thread(_publish,board,value,exclude)


def _events(after):
    with database.connection() as db:
        rows=db.execute('SELECT id,board_id,payload FROM pizarra_live_events WHERE id>? ORDER BY id LIMIT 500',(after,)).fetchall()
    return rows


def _head():
    with database.connection() as db:
        return db.execute('SELECT COALESCE(MAX(id),0) FROM pizarra_live_events').fetchone()[0]


async def _replay(after,callback):
    # Notifications can be lost while LISTEN reconnects. The short-lived event
    # log fills that gap in commit order, without replaying old ink on first join.
    while True:
        rows=await asyncio.to_thread(_events,after)
        if not rows:return after
        for row in rows:
            value=json.loads(row['payload'])
            if value.pop('_node',None)!=NODE:
                exclude=value.pop('_exclude',None)
                await callback(row['board_id'],value,exclude)
            after=row['id']
        if len(rows)<500:return after


async def listen(callback,ready):
    import psycopg
    after=await asyncio.to_thread(_head)
    while True:
        try:
            # LISTEN requires the direct endpoint, not a transaction pooler.
            direct=os.environ.get('PIZARRA_DATABASE_DIRECT_URL') or os.environ.get('DATABASE_URL_UNPOOLED') or database.url()
            async with await psycopg.AsyncConnection.connect(direct,autocommit=True,connect_timeout=15) as connection:
                await connection.execute('LISTEN pizarra_live')
                after=await _replay(after,callback)
                ready.set()
                async for notification in connection.notifies():
                    after=await _replay(after,callback)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            logger.warning('Canal compartido desconectado (%s); se reintentara la conexion.',type(error).__name__)
            ready.clear()
            await asyncio.sleep(1)


async def ensure_listener(callback):
    loop=asyncio.get_running_loop()
    previous=_listeners.get(loop)
    if previous is None or previous[0].done():
        ready=asyncio.Event()
        _listeners[loop]=(loop.create_task(listen(callback,ready)),ready)
    await asyncio.wait_for(_listeners[loop][1].wait(),20)


async def stop_listener():
    # No background listener is needed once this instance has no sockets.
    # Closing it lets Neon suspend its compute during idle periods.
    previous=_listeners.pop(asyncio.get_running_loop(),None)
    if previous:
        previous[0].cancel()
        try:await previous[0]
        except asyncio.CancelledError:pass


@contextmanager
def html_state(board,cache):
    # Called within one worker-thread transaction. Socket sends are buffered
    # until commit, so cancellation never abandons a checked-out connection or
    # advisory lock while a database operation is still executing in a thread.
    with database.connection() as connection:
            connection.execute('SELECT pg_advisory_xact_lock(hashtextextended(?,0))',('html:'+board,))
            row=connection.execute("SELECT value FROM pizarra_live_state WHERE board_id=? AND kind='html'",(board,)).fetchone()
            cache[board]=json.loads(row['value']) if row else {}
            active={p['client_id'] for p in connection.execute('SELECT client_id FROM pizarra_live_peers WHERE board_id=? AND seen>?',(board,time.time()-45))}
            for state in cache[board].values():
                if state.get('running') and state.get('owner_id') not in active:
                    state['running']=False
            yield
            connection.execute("INSERT INTO pizarra_live_state VALUES(?,'html',?) ON CONFLICT(board_id,kind) DO UPDATE SET value=excluded.value",
                                    (board,json.dumps(cache[board],ensure_ascii=False)))
