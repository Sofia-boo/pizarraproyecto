"""Real processes and sockets, using an isolated local PostgreSQL schema only."""
import os
import socket
import subprocess
import sys
import time
import unittest
from pathlib import Path

import httpx
from websockets.sync.client import connect
from tests import test_backend as backend_fixture


@unittest.skipUnless(os.environ.get('PIZARRA_TEST_DATABASE_URL'), 'Requires local isolated PostgreSQL')
class CloudIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        backend_fixture.BackendTest.setUpClass.__func__(cls)
        cls.processes=[]
        cls.logs=[]
        cls.urls=[]
        try:
            for index in range(2):
                with socket.socket() as listener:
                    listener.bind(('127.0.0.1',0));port=listener.getsockname()[1]
                log=open(Path(cls.storage.name)/f'node-{index}.log','w',encoding='utf-8')
                cls.logs.append(log)
                code=("import asyncio; asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy()); " if os.name=='nt' else '')
                code+=f"import uvicorn; uvicorn.run('reconocimiento_local.server:app',host='127.0.0.1',port={port},loop='none',log_level='warning')"
                process=subprocess.Popen([sys.executable,'-c',code],env=os.environ.copy(),stdout=log,stderr=log)
                cls.processes.append(process);base=f'http://127.0.0.1:{port}';cls.urls.append(base)
                end=time.monotonic()+30
                while True:
                    try:
                        if httpx.get(base+'/healthz',timeout=1).status_code==200:break
                    except httpx.HTTPError:pass
                    if process.poll() is not None or time.monotonic()>end:
                        raise RuntimeError('Isolated test server did not start; see temporary node log.')
                    time.sleep(.1)
        except BaseException:
            cls.tearDownClass();raise

    @classmethod
    def tearDownClass(cls):
        for process in cls.processes:
            process.terminate();process.wait(timeout=10)
        for log in cls.logs:log.close()
        backend_fixture.BackendTest.tearDownClass.__func__(cls)

    def receive(self,ws,kind,**criteria):
        import json
        end=time.monotonic()+15
        while True:
            value=json.loads(ws.recv(timeout=max(.1,end-time.monotonic())))
            if value.get('type')==kind and all(value.get(k)==v for k,v in criteria.items()):return value
            if time.monotonic()>end:self.fail(f'Missing event {kind}')

    def test_a_migration_refuses_overwrite_and_backup_remains_readable(self):
        import sqlite3
        from scripts.migrar_neon import migrate
        from reconocimiento_local.server import db_connection
        from reconocimiento_local.cloud_database import placeholders
        self.assertEqual(placeholders("SELECT '?' AS literal, ? AS value"),"SELECT '?' AS literal, %s AS value")
        with self.assertRaisesRegex(RuntimeError,'destino debe estar vacio'):
            migrate(Path(self.storage.name).resolve()/'pizarras.db',os.environ['PIZARRA_DATABASE_URL'])
        restored=sqlite3.connect(':memory:')
        try:
            with db_connection() as source:
                source.backup(restored)
                self.assertEqual(source.execute('SELECT COUNT(*) FROM boards').fetchone()[0],
                                 restored.execute('SELECT COUNT(*) FROM boards').fetchone()[0])
                self.assertEqual(source.execute('SELECT COUNT(*) FROM anonymous_users').fetchone()[0],
                                 restored.execute('SELECT COUNT(*) FROM anonymous_users').fetchone()[0])
            self.assertEqual(restored.execute('PRAGMA integrity_check').fetchone()[0],'ok')
            self.assertTrue(restored.execute("SELECT 1 FROM sqlite_master WHERE type='index' AND name='ux_anon_login'").fetchone())
        finally:restored.close()

    def test_bulk_ink_acknowledgements_use_bounded_queries_and_do_not_revive_deletions(self):
        import uuid
        from unittest.mock import patch
        from reconocimiento_local import cloud_live, cloud_database
        board='bulk-'+uuid.uuid4().hex
        identifiers=[f'bulk-{index}' for index in range(400)]
        queries=[]
        execute=cloud_database.Connection.execute
        def measured(connection,statement,params=()):
            queries.append(statement)
            return execute(connection,statement,params)
        with patch.object(cloud_database.Connection,'execute',measured):
            cloud_live.remember_ink(board,5,identifiers,[identifiers[-1]])
        # Network round trips must stay bounded as the paragraph grows.
        self.assertLessEqual(len(queries),3)
        event=cloud_live.ink_events(board)[0]
        self.assertEqual(set(event['saved']),set(identifiers[:-1]))
        self.assertEqual(event['removed'],[identifiers[-1]])
        cloud_live.remember_ink(board,4,[identifiers[-1]],[])
        self.assertEqual(cloud_live.ink_events(board)[0]['removed'],[identifiers[-1]])
        cloud_live.remember_ink(board,6,[],identifiers)
        events=cloud_live.ink_events(board)
        self.assertEqual(len(events),1)
        self.assertEqual(events[0]['version'],6)
        self.assertEqual(set(events[0]['removed']),set(identifiers))
        self.assertEqual(events[0]['saved'],[])

    def test_two_nodes_share_tickets_draw_delete_html_and_large_assets(self):
        with httpx.Client(base_url=self.urls[0],timeout=20) as a, httpx.Client(base_url=self.urls[1],timeout=20) as b:
            self.assertEqual(a.post('/api/auth/guest',json={'name':'Cloud owner','password':'cloud-password'}).status_code,200)
            self.assertEqual(b.post('/api/auth/guest',json={'name':'Cloud editor','password':'cloud-password'}).status_code,200)
            board=a.post('/api/boards',json={'name':'Independent nodes'}).json()['id']
            code=a.post(f'/api/share/boards/{board}/code').json()['code']
            self.assertEqual(b.post('/api/share/join-code',json={'code':code}).status_code,200)
            content={'strokes':[],'shapes':[{'id':'html-live','kind':'rectangle','visualType':'html','x':0,'y':0,
              'width':640,'height':440,'color':'#64748b','strokeWidth':1,'html':{'name':'live.html','source':'<button>1</button>'}}]}
            self.assertEqual(a.put(f'/api/boards/{board}',json={'version':0,'content':content}).status_code,200)
            # Obtain each one-use ticket on the OTHER instance.
            ta=b.get(f'/api/boards/{board}/live-ticket').json()['url'].split('?')[1]
            tb=a.get(f'/api/boards/{board}/live-ticket').json()['url'].split('?')[1]
            with connect(self.urls[0].replace('http:','ws:')+f'/api/live/{board}?'+ta) as wa, \
                 connect(self.urls[1].replace('http:','ws:')+f'/api/live/{board}?'+tb) as wb:
                self.receive(wa,'board_version');self.receive(wb,'board_version')
                import json
                # wa belongs to editor (ticket from b), wb to owner (from a).
                wa.send(json.dumps({'type':'stroke_start','stroke_id':'cloud-ink','point':{'x':1,'y':2},'color':'#202020','width':3}))
                self.receive(wb,'stroke_start',stroke_id='cloud-ink')
                wa.send(json.dumps({'type':'stroke_end','stroke_id':'cloud-ink'}))
                self.receive(wb,'stroke_end',stroke_id='cloud-ink')
                content['strokes']=[{'id':'cloud-ink','points':[{'x':1,'y':2}],'color':'#202020','width':3}]
                self.assertEqual(b.put(f'/api/boards/{board}',json={'version':1,'content':content}).status_code,200)
                self.receive(wb,'board_version',version=2)
                content['strokes']=[]
                self.assertEqual(a.put(f'/api/boards/{board}',json={'version':2,'content':content}).status_code,200)
                deletion=self.receive(wa,'board_version',version=3)
                self.assertIn('cloud-ink',deletion['deletions']['strokes'])
                self.receive(wa,'ink_settled',version=3)
                self.assertEqual(b.put(f'/api/boards/{board}',json={'version':2,'content':content}).status_code,409)
                wa.send(json.dumps({'type':'html_start','html_id':'html-live','request':'cloud-session'}))
                self.receive(wb,'html_session',session='cloud-session')
                wb.send(json.dumps({'type':'html_input','html_id':'html-live','session':'cloud-session','event':{'action':'click','node':'5'}}))
                self.receive(wa,'html_input',session='cloud-session')
                wa.send(json.dumps({'type':'html_frame','html_id':'html-live','session':'cloud-session','base':0,'prefix':0,'remove':0,'text':'<button>2</button>'}))
                self.receive(wb,'html_patch',revision=1)
                wb.send(json.dumps({'type':'html_stop','html_id':'html-live','session':'cloud-session'}))
                self.assertFalse(self.receive(wa,'html_stop')['running'])
            # A multi-megabyte file never exceeds the function's request limit.
            data=bytes(range(256))*20000
            for offset in range(0,len(data),1_000_000):
                result=a.put(f'/api/assets/cloud-large?upload_id=multi&offset={offset}&total={len(data)}',
                             content=data[offset:offset+1_000_000],headers={'Content-Type':'image/png'})
                self.assertEqual(result.status_code,200,result.text)
            download=b.get('/api/assets/cloud-large',headers={'Range':'bytes=0-999999'})
            self.assertEqual(download.status_code,404)  # Still private to uploader.
            received=b''
            for offset in range(0,len(data),1_000_000):
                part=a.get('/api/assets/cloud-large',headers={'Range':f'bytes={offset}-{offset+999999}'})
                self.assertEqual(part.status_code,206);received+=part.content
            self.assertEqual(received,data)
            from concurrent.futures import ThreadPoolExecutor
            # More parallel uploads than the connection pool has slots. The
            # permission layer must release its connection before the handler.
            with ThreadPoolExecutor(max_workers=12) as workers:
                uploads=list(workers.map(lambda index:a.put(f'/api/assets/concurrent-{index}',
                  content=b'fixture',headers={'Content-Type':'image/png'}).status_code,range(12)))
            self.assertEqual(uploads,[200]*12)
            race=a.post('/api/boards',json={'name':'Concurrent version'}).json()['id']
            with ThreadPoolExecutor(max_workers=2) as workers:
                writes=list(workers.map(lambda _:a.put(f'/api/boards/{race}',json={'version':0,'content':{'strokes':[]}}).status_code,range(2)))
            self.assertEqual(sorted(writes),[200,409])
            # Stop one server entirely: the other retains the board and login.
            self.processes[0].terminate();self.processes[0].wait(timeout=10)
            self.assertEqual(b.get(f'/api/boards/{board}').json()['content']['strokes'],[])
            self.assertEqual(b.get('/api/library').status_code,200)


if __name__=='__main__':unittest.main()
