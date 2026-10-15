"""Integration checks against isolated storage, never the user's database."""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient


class BackendTest(unittest.TestCase):
    def test_study_ai_routes_require_session_and_do_not_expose_key(self):
        from unittest.mock import patch
        with patch.dict(os.environ, {'GEMINI_API_KEY': ''}), TestClient(self.app,base_url='https://testserver') as client:
            self.assertEqual(client.get('/api/study-ai/status').status_code,401)
            self.assertEqual(client.post('/api/auth/guest',json={'name':'Study AI test','password':'study-test-password'}).status_code,200)
            self.assertEqual(client.get('/api/study-ai/status').json(),{'configured':False,'provider':'Gemini'})
            self.assertEqual(client.post('/api/study-ai/consult',data={'prompt':'1+1'}).status_code,503)

    def test_never_saved_ink_deletions_are_confirmed_and_replayed_after_disconnect(self):
        from unittest.mock import patch
        from reconocimiento_local.live_sync_api import _ink_events
        events=[]
        async def broadcast(board_id,event,**_):
            events.append(event)
        with TestClient(self.app,base_url='https://testserver') as client:
            client.post('/api/auth/guest',json={'name':'Discarded pen','password':'pen-password'})
            board=client.post('/api/boards',json={'name':'Pen deletion fixture'}).json()['id']
            with patch('reconocimiento_local.live_sync_api._broadcast',side_effect=broadcast):
                # No live clients and no prior save containing these IDs.
                result=client.put(f'/api/boards/{board}',json={'version':0,
                    'changes':{'strokes':{'upsert':[],'remove':['never-saved-1','never-saved-2']}},
                    'discarded_strokes':['never-saved-1','never-saved-2']})
            self.assertEqual(result.status_code,200,result.text)
            self.assertEqual(client.get(f'/api/boards/{board}').json()['content']['strokes'],[])
            self.assertEqual(events[0]['deletions']['strokes'],['never-saved-1','never-saved-2'])
            settled=next(event for event in events if event['type']=='ink_settled')
            self.assertEqual(settled['removed'],['never-saved-1','never-saved-2'])
            self.assertEqual(_ink_events(board),[settled])
            bad=client.put(f'/api/boards/{board}',json={'version':1,'content':{},'discarded_strokes':['x'*81]})
            self.assertEqual(bad.status_code,422)

    def test_shared_board_removal_is_personal_for_creator_editor_and_viewer(self):
        with TestClient(self.app,base_url='https://testserver') as owner,TestClient(self.app,base_url='https://testserver') as editor,TestClient(self.app,base_url='https://testserver') as viewer,TestClient(self.app,base_url='https://testserver') as outsider:
            for client,name in [(owner,'Hidden owner'),(editor,'Hidden editor'),(viewer,'Hidden viewer'),(outsider,'Hidden outsider')]:
                self.assertEqual(client.post('/api/auth/guest',json={'name':name,'password':'hide-password'}).status_code,200)
            folder=owner.post('/api/folders',json={'name':'Materia original'}).json()['id']
            board=owner.post('/api/boards',json={'name':'Apuntes compartidos','folder_id':folder}).json()['id']
            content={'texts':[{'id':'text-preserved','x':10,'y':20,'text':'Conservar los apuntes','fontSize':22,'color':'#111827'}]}
            self.assertEqual(owner.put(f'/api/boards/{board}',json={'version':0,'content':content}).status_code,200)
            code=owner.post(f'/api/share/boards/{board}/code',json={}).json()['code']
            editor.post('/api/share/join-code',json={'code':code})
            link=owner.post(f'/api/share/boards/{board}',json={'role':'viewer','days':7}).json()['token']
            viewer.post('/api/share/join',json={'token':link})
            placement=editor.get('/api/library').json()['boards'][0]['folder_id']
            self.assertEqual(outsider.delete(f'/api/boards/{board}').status_code,403)
            for client in [editor,viewer]:
                self.assertEqual(client.delete(f'/api/boards/{board}').status_code,200)
                self.assertEqual(client.delete(f'/api/boards/{board}').status_code,200)
                self.assertNotIn(board,[b['id'] for b in client.get('/api/library').json()['boards']])
            self.assertIn(board,[b['id'] for b in owner.get('/api/library').json()['boards']])
            self.assertEqual(owner.get(f'/api/boards/{board}').json()['content'],content)
            # The creator can also remove it without deleting it for members.
            editor.post('/api/share/join-code',json={'code':code})
            self.assertEqual(editor.get('/api/library').json()['boards'][0]['folder_id'],placement)
            self.assertEqual(owner.delete(f'/api/boards/{board}').status_code,200)
            self.assertNotIn(board,[b['id'] for b in owner.get('/api/library').json()['boards']])
            self.assertEqual(editor.get(f'/api/boards/{board}').json()['content'],content)
            self.assertEqual(editor.put(f'/api/boards/{board}',json={'version':1,'content':content}).status_code,200)
            self.assertIn(board,[b['id'] for b in editor.get('/api/library').json()['boards']])
            owner.post('/api/share/join-code',json={'code':code})
            self.assertEqual(owner.get('/api/library').json()['boards'][0]['folder_id'],folder)
            self.assertEqual(owner.get(f'/api/boards/{board}').json()['version'],2)

    def test_compact_removal_preserves_unseen_objects_and_rejects_insertions(self):
        with TestClient(self.app,base_url='https://testserver') as client:
            client.post('/api/auth/guest',json={'name':'Compact removals','password':'compact-password'})
            board=client.post('/api/boards',json={'name':'Removal fixture'}).json()['id']
            content={'texts':[{'id':'remove-me','text':'old'},{'id':'unseen','text':'keep'}]}
            self.assertEqual(client.put(f'/api/boards/{board}',json={'version':0,'content':content}).status_code,200)
            payload={'version':1,'changes':{'texts':{'upsert':[],'remove':['remove-me']}},'camera':{'x':0,'y':0,'zoom':1}}
            response=client.put(f'/api/boards/{board}',json=payload)
            self.assertEqual(response.status_code,200,response.text)
            self.assertNotIn('content',response.json())
            self.assertEqual(client.get(f'/api/boards/{board}').json()['content']['texts'],[content['texts'][1]])
            self.assertEqual(client.put(f'/api/boards/{board}',json=payload).status_code,409)
            payload['version']=2
            payload['changes']['texts']['upsert']=[{'id':'smuggled','text':'no'}]
            self.assertEqual(client.put(f'/api/boards/{board}',json=payload).status_code,422)

    def test_retired_ocr_routes_are_absent_and_boards_still_load(self):
        paths={route.path for route in self.app.routes if hasattr(route,'path')}
        self.assertFalse(any(path.startswith(('/recognize/','/api/ocr/')) for path in paths))
        with TestClient(self.app,base_url='https://testserver') as client:
            self.assertEqual(client.post('/api/auth/guest',json={'name':'OCR retirado','password':'retired-password'}).status_code,200)
            self.assertEqual(client.get('/api/library').status_code,200)
            self.assertEqual(client.get('/healthz').json(),{'ok':True})

    def test_chatgpt_restart_only_resumes_the_requesting_users_activated_browser(self):
        import time
        from unittest.mock import patch
        from reconocimiento_local.chatgpt_browser import BrowserService
        class Process:
            def poll(self):return None
        class Bridge:
            def __init__(self, uid):self.uid=uid;self.process=None;self.updated=0;self.state={'state':'closed'};self.calls=[]
            def call(self, action):
                self.calls.append(action);self.updated=time.time();self.process=Process();self.state={'state':'ready'};return self.state
            def close(self, keep_browser=False):self.calls.append('detach' if keep_browser else 'close')
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'owner').mkdir();(root/'owner'/'DevToolsActivePort').write_text('12345\n/devtools/browser/fixture')
            with patch('reconocimiento_local.chatgpt_browser.profile_directory',lambda uid:root/uid):
                service=BrowserService(Bridge)
                self.assertEqual(service.status('other'),{'state':'closed','busy':False})
                self.assertEqual(service.bridges,{})
                self.assertEqual(service.status('owner'),{'state':'ready','busy':False})
                self.assertEqual(service.bridges['owner'].calls,['attach'])
                self.assertEqual(service.status('owner'),{'state':'ready','busy':False})
                service.close_all()
                self.assertEqual(service.bridges['owner'].calls,['attach','detach'])

    def test_chatgpt_jobs_are_private_idempotent_and_upload_only_explicit_files(self):
        import time
        from unittest.mock import patch
        from reconocimiento_local.chatgpt_browser import BrowserService
        class Bridge:
            def __init__(self, uid):
                self.state={'state':'closed'};self.updated=0;self.process=None;self.calls=[]
            def call(self, action, **payload):
                self.updated=time.time()
                if action=='login':self.state={'state':'manual_login'}
                if action=='open':self.state={'state':'ready'}
                if action=='ask':self.calls.append(payload);return {'text':'browser fallback','html':'<h2>Solución</h2><span class="katex"><math><annotation encoding="application/x-tex">\\frac{1}{2}</annotation></math></span>'}
                return self.state
            def close(self, **kwargs):pass
        service=BrowserService(Bridge)
        with patch('reconocimiento_local.chatgpt_browser.service',service),TestClient(self.app,base_url='https://testserver') as owner,TestClient(self.app,base_url='https://testserver') as other:
            self.assertEqual(owner.get('/api/chatgpt/status').status_code,401)
            uid=owner.post('/api/auth/guest',json={'name':'Browser owner','password':'browser-pass'}).json()['id']
            other.post('/api/auth/guest',json={'name':'Browser other','password':'browser-pass'})
            opened=owner.post('/api/chatgpt/open')
            self.assertEqual(opened.status_code,200,opened.text)
            self.assertEqual(opened.json()['state'],'manual_login')
            self.assertEqual(owner.post('/api/chatgpt/consult',data={'request_id':'manual-login-000000','prompt':'2+2'}).status_code,409)
            self.assertEqual(owner.post('/api/chatgpt/activate').json()['state'],'ready')
            self.assertEqual(other.get('/api/chatgpt/status').json()['state'],'closed')
            body={'request_id':'personal-query-0000000001','prompt':'Resolvé el recorte'}
            files=[('files',('private-name.png',b'PNG owned crop','image/png'))]
            posted=owner.post('/api/chatgpt/consult',data=body,files=files)
            self.assertEqual(posted.status_code,202,posted.text)
            job=posted.json()['id']
            for _ in range(100):
                result=owner.get('/api/chatgpt/consult/'+job).json()
                if result['status']!='running':break
                time.sleep(.01)
            self.assertEqual(result['status'],'complete')
            self.assertIn('\\frac',result['text'])
            self.assertNotIn('browser fallback',result['text'])
            self.assertEqual(other.get('/api/chatgpt/consult/'+job).status_code,404)
            self.assertEqual(other.post('/api/chatgpt/consult',data=body,files=files).status_code,409)
            self.assertEqual(owner.post('/api/chatgpt/consult',data=body,files=files).json()['id'],job)
            self.assertEqual(len(service.bridges[uid].calls),1)
            sent=service.bridges[uid].calls[0]
            self.assertEqual(sent['prompt'],'Resolvé el recorte')
            self.assertEqual(sent['files'][0]['name'],'ejercicio-1.png')
            import base64
            self.assertEqual(base64.b64decode(sent['files'][0]['data']),b'PNG owned crop')
            self.assertEqual(owner.post('/api/chatgpt/consult',data=body,files=[('files',('bad.svg',b'<svg/>','image/svg+xml'))]).status_code,422)
            self.assertEqual(owner.post('/api/chatgpt/consult',data=body,files=files*4).status_code,422)

    def setUp(self):
        # Each test is an independent session in the isolated temporary server.
        from reconocimiento_local.anonymous_users import _rate
        _rate.clear()
        if getattr(self,'cloud_schema',None):
            from reconocimiento_local.server import db_connection
            with db_connection() as db:db.execute('DELETE FROM pizarra_rate')

    def test_four_digit_codes_preserve_personal_folders_and_rejoin_without_duplicates(self):
        import time
        from reconocimiento_local.server import db_connection
        with TestClient(self.app,base_url='https://testserver') as owner,TestClient(self.app,base_url='https://testserver') as editor:
            owner.post('/api/auth/guest',json={'name':'Four digits owner','password':'code-password'})
            folder=owner.post('/api/folders',json={'name':'Materia del creador'}).json()['id']
            board=owner.post('/api/boards',json={'name':'Con código','folder_id':folder}).json()['id']
            code=owner.post(f'/api/share/boards/{board}/code',json={})
            self.assertEqual(code.status_code,200,code.text)
            self.assertRegex(code.json()['code'],r'^\d{4}$')
            self.assertEqual(owner.post(f'/api/share/boards/{board}/code',json={}).json()['code'],code.json()['code'])
            owner.post('/api/share/join-code',json={'code':code.json()['code']})
            self.assertEqual(owner.get('/api/library').json()['boards'][0]['folder_id'],folder)
            self.assertEqual(len(owner.get('/api/library').json()['folders']),1)
            editor.post('/api/auth/guest',json={'name':'Code editor','password':'code-password'})
            self.assertEqual(editor.post('/api/share/join-code',json={'code':'x234'}).status_code,422)
            joined=editor.post('/api/share/join-code',json={'code':code.json()['code']})
            self.assertEqual(joined.status_code,200,joined.text)
            self.assertEqual(joined.json()['board_id'],board)
            library=editor.get('/api/library').json()
            self.assertEqual(library['folders'][0]['name'],'Pizarra compartida')
            self.assertEqual(library['boards'][0]['folder_id'],library['folders'][0]['id'])
            personal=editor.post('/api/folders',json={'name':'Mis apuntes'}).json()['id']
            self.assertEqual(editor.put(f'/api/boards/{board}/info',json={'name':'Personal','folder_id':personal}).status_code,200)
            self.assertEqual(editor.post('/api/share/join-code',json={'code':code.json()['code']}).status_code,200)
            library=editor.get('/api/library').json()
            self.assertEqual(len(library['boards']),1)
            self.assertEqual(library['boards'][0]['folder_id'],personal)
            self.assertEqual(owner.get('/api/library').json()['boards'][0]['folder_id'],folder)
            self.assertEqual(owner.get('/api/library').json()['boards'][0]['name'],'Con código')
            self.assertEqual(editor.post(f'/api/share/boards/{board}/code',json={}).status_code,403)
            with db_connection() as db:db.execute('UPDATE share_codes SET expires_at=? WHERE code=?',(int(time.time())-1,code.json()['code']))
            self.assertEqual(editor.post('/api/share/join-code',json={'code':code.json()['code']}).status_code,404)
            for _ in range(9):editor.post('/api/share/join-code',json={'code':code.json()['code']})
            self.assertEqual(editor.post('/api/share/join-code',json={'code':code.json()['code']}).status_code,429)

    def test_explicit_changes_preserve_unseen_objects_and_acknowledge_the_complete_scene(self):
        with TestClient(self.app, base_url='https://testserver') as client:
            client.post('/api/auth/guest', json={'name':'Delta contributor','password':'delta-password'})
            board=client.post('/api/boards', json={'name':'Explicit changes'}).json()['id']
            known={'id':'known','text':'Known','x':10,'y':10,'fontSize':18,'color':'#000000'}
            unseen={**known,'id':'unseen','text':'Another contribution'}
            self.assertEqual(client.put('/api/boards/'+board,json={'version':0,'content':{'texts':[known,unseen]}}).status_code,200)
            edited={**known,'text':'My edit'}
            result=client.put('/api/boards/'+board,json={'version':1,'content':{'texts':[edited]},
                'changes':{'texts':{'upsert':[edited],'remove':[]}}})
            self.assertEqual(result.status_code,200,result.text)
            self.assertEqual(result.json()['content']['texts'],[edited,unseen])
            self.assertEqual(client.get('/api/boards/'+board).json()['content']['texts'],[edited,unseen])
            result=client.put('/api/boards/'+board,json={'version':2,'content':{'texts':[edited]},
                'changes':{'texts':{'upsert':[],'remove':['unseen']}}})
            self.assertEqual(result.status_code,200,result.text)
            self.assertEqual(client.get('/api/boards/'+board).json()['content']['texts'],[edited])
            # A delta cannot bypass the body checked by the permissions middleware.
            injected={'id':'injected','assetId':'private-asset','x':0,'y':0,'width':20,'height':20}
            bad=client.put('/api/boards/'+board,json={'version':3,'content':{'texts':[edited],'media':[]},
                'changes':{'media':{'upsert':[injected],'remove':[]}}})
            self.assertEqual(bad.status_code,422,bad.text)
            self.assertEqual(client.get('/api/boards/'+board).json()['version'],3)

    def test_live_patch_only_sends_changes_and_falls_back_for_order_or_large_payloads(self):
        from reconocimiento_local.live_sync_api import scene_patch
        before={'texts':[{'id':'a','text':'Original'}],'graphs':[]}
        after={'texts':[{'id':'a','text':'Editado'}],'graphs':[{'id':'g','formulas':[]}]}
        self.assertEqual(scene_patch(before,after),{'texts':{'upsert':after['texts'],'remove':[]},'graphs':{'upsert':after['graphs'],'remove':[]}})
        self.assertEqual(scene_patch(after,{'texts':[],'graphs':[]})['graphs']['remove'],['g'])
        self.assertIsNone(scene_patch({'texts':[{'id':'a'}]},{'texts':[{'id':'new'},{'id':'a'}]}))
        self.assertIsNone(scene_patch({}, {'texts':[{'id':'large','text':'x'*512001}]}))
        self.assertIsNone(scene_patch({}, {'strokes':[{'points':[]}]}))

    def test_media_permissions_are_committed_before_live_notification(self):
        from unittest.mock import patch
        from reconocimiento_local.server import db_connection
        from reconocimiento_local.anonymous_users import asset_access
        with TestClient(self.app, base_url='https://testserver') as a, TestClient(self.app, base_url='https://testserver') as b:
            a.post('/api/auth/guest', json={'name':'Media owner','password':'test-password'})
            uid=b.post('/api/auth/guest', json={'name':'Media contributor','password':'test-password'}).json()['id']
            bid=a.post('/api/boards',json={'name':'Media atomic'}).json()['id']
            token=a.post(f'/api/share/boards/{bid}',json={'role':'editor'}).json()['token']
            b.post('/api/share/join',json={'token':token})
            self.assertEqual(a.put('/api/assets/atomic-image',content=b'image',headers={'Content-Type':'image/png'}).status_code,200)
            async def notified(board_id,version,*_):
                with db_connection() as db:
                    self.assertTrue(asset_access(db,uid,'atomic-image'))
            with patch('reconocimiento_local.live_sync_api.notify_board_saved',side_effect=notified):
                response=a.put(f'/api/boards/{bid}',json={'version':0,'content':{'media':[{'assetId':'atomic-image'}]}})
                self.assertEqual(response.status_code,200,response.text)
            self.assertEqual(b.get('/api/assets/atomic-image').status_code,200)
            self.assertEqual(b.put(f'/api/boards/{bid}',json={'version':1,'content':{'media':[]}}).status_code,200)

    @classmethod
    def setUpClass(cls):
        cls.storage = tempfile.TemporaryDirectory()
        cls.previous_data_dir = os.environ.get('PIZARRA_DATA_DIR')
        os.environ['PIZARRA_DATA_DIR'] = cls.storage.name
        cls.cloud_schema=None
        if os.environ.get('PIZARRA_TEST_DATABASE_URL'):
            import asyncio, uuid, psycopg
            from urllib.parse import urlsplit
            from psycopg.conninfo import make_conninfo
            from psycopg import sql
            target=os.environ['PIZARRA_TEST_DATABASE_URL']
            if urlsplit(target).hostname not in ('127.0.0.1','localhost'):
                raise RuntimeError('Cloud tests require an isolated local PostgreSQL server.')
            if os.name=='nt':asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
            subprocess.run([sys.executable,'-c','from reconocimiento_local.server import app'],check=True,env={k:v for k,v in os.environ.items() if k not in ('VERCEL','DATABASE_URL','PIZARRA_DATABASE_URL')})
            import sqlite3
            with sqlite3.connect(Path(cls.storage.name)/'pizarras.db') as seed:
                seed.execute('CREATE TABLE migration_precision(id TEXT PRIMARY KEY, created REAL, data BLOB)')
                seed.execute('INSERT INTO migration_precision VALUES (?,?,?)',('fixture',1792071448.313789,b'precision-fixture'))
            cls.cloud_schema='pizarra_test_'+uuid.uuid4().hex
            with psycopg.connect(target,autocommit=True) as db:
                db.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(cls.cloud_schema)))
            scoped=make_conninfo(target,options='-c search_path='+cls.cloud_schema)
            from scripts.migrar_neon import migrate
            migrate(Path(cls.storage.name).resolve()/'pizarras.db',scoped)
            os.environ['PIZARRA_DATABASE_URL']=scoped
            os.environ['PIZARRA_DATABASE_DIRECT_URL']=scoped
        from reconocimiento_local.server import app
        cls.app = app

    @classmethod
    def tearDownClass(cls):
        if cls.previous_data_dir is None:
            os.environ.pop('PIZARRA_DATA_DIR', None)
        else:
            os.environ['PIZARRA_DATA_DIR'] = cls.previous_data_dir
        # Windows may retain SQLite handles until garbage collection.
        import gc
        gc.collect()
        cls.storage.cleanup()
        if cls.cloud_schema:
            from reconocimiento_local import cloud_database
            cloud_database._pool.close();cloud_database._pool=None
            import psycopg
            from psycopg import sql
            with psycopg.connect(os.environ['PIZARRA_TEST_DATABASE_URL'],autocommit=True) as db:
                db.execute(sql.SQL('DROP SCHEMA {} CASCADE').format(sql.Identifier(cls.cloud_schema)))
            os.environ.pop('PIZARRA_DATABASE_URL',None);os.environ.pop('PIZARRA_DATABASE_DIRECT_URL',None)

    def test_login_save_isolation_and_restart(self):
        with TestClient(self.app, base_url='https://testserver') as client:
            self.assertEqual(client.get('/healthz').status_code, 200)
            self.assertEqual(client.get('/api/auth/me').status_code, 401)
            self.assertEqual(client.get('/api/library').status_code, 401)
            response = client.post('/api/auth/guest', json={
                'name': 'Prueba persistencia', 'password': 'test-password', 'color': '#6366f1'})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertIn('Secure', response.headers['set-cookie'])
            self.assertEqual(client.get('/api/auth/me').status_code, 200)
            response = client.post('/api/boards', json={'name': 'Guardado de prueba'})
            self.assertEqual(response.status_code, 200, response.text)
            board_id = response.json()['id']
            content = {'strokes': [], 'texts': [{'text': 'Persistente'}]}
            response = client.put(f'/api/boards/{board_id}', json={'content': content, 'version': 0})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(client.get(f'/api/boards/{board_id}').json()['content'], content)
            with client.websocket_connect(f'wss://testserver/api/live/{board_id}') as socket:
                self.assertEqual(socket.receive_json()['type'], 'board_version')
                self.assertEqual(socket.receive_json()['type'], 'presence')
            ticket = client.get(f'/api/boards/{board_id}/live-ticket')
            self.assertEqual(ticket.status_code,200,ticket.text)
            self.assertIn('no-store',ticket.headers['cache-control'])
            from starlette.websockets import WebSocketDisconnect
            with TestClient(self.app, base_url='https://testserver') as no_cookies:
                with no_cookies.websocket_connect(ticket.json()['url']) as socket:
                    self.assertEqual(socket.receive_json()['type'],'board_version')
                with self.assertRaises(WebSocketDisconnect):
                    with no_cookies.websocket_connect(ticket.json()['url']):
                        pass
            client.post('/api/auth/logout')
            self.assertEqual(client.get('/api/auth/me').status_code, 401)
            bad = client.post('/api/auth/login', json={'name': 'Prueba persistencia', 'password': 'wrong'})
            self.assertEqual(bad.status_code, 401)
            good = client.post('/api/auth/login', json={'name': 'Prueba persistencia', 'password': 'test-password'})
            self.assertEqual(good.status_code, 200, good.text)
            with TestClient(self.app, base_url='https://testserver') as other:
                response = other.post('/api/auth/guest', json={
                    'name': 'Otra persona', 'password': 'another-password', 'color': '#6366f1'})
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(other.get(f'/api/boards/{board_id}').status_code, 403)
                self.assertEqual(other.get(f'/api/boards/{board_id}/live-ticket').status_code, 403)

        # A fresh interpreter reopens the same persistent storage and sessions.
        result = subprocess.run([sys.executable, '-c',
            "from reconocimiento_local.server import db_connection\n"
            "with db_connection() as db:\n"
            "    assert db.execute('SELECT content FROM boards WHERE id=?', (__import__('sys').argv[1],)).fetchone()", board_id], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((Path(self.storage.name) / 'letter_samples.json').exists())
        paths = set(self.app.openapi()['paths'])
        self.assertIn('/api/excel/import', paths)
        self.assertTrue(any('history' in path for path in paths))

    def test_visual_objects_validate_permissions_and_history(self):
        import copy
        with TestClient(self.app, base_url='https://testserver') as owner, \
                TestClient(self.app, base_url='https://testserver') as editor, \
                TestClient(self.app, base_url='https://testserver') as viewer:
            for client, name in ((owner, 'Visual owner'), (editor, 'Visual editor'), (viewer, 'Visual viewer')):
                self.assertEqual(client.post('/api/auth/guest', json={'name': name, 'password': 'visual-password'}).status_code, 200)
            board = owner.post('/api/boards', json={'name': 'Visual phase one'}).json()['id']
            for client, role in ((editor, 'editor'), (viewer, 'viewer')):
                token = owner.post(f'/api/share/boards/{board}', json={'role': role}).json()['token']
                self.assertEqual(client.post('/api/share/join', json={'token': token}).status_code, 200)
            note = {'id': 'note-a', 'kind': 'rectangle', 'visualType': 'sticky', 'x': 10, 'y': 20, 'width': 230,
                    'height': 180, 'color': '#202020', 'strokeWidth': 1,
                    'note': {'text': 'Study together', 'fontSize': 20, 'background': '#fff0a6'}}
            connector = {'id': 'edge', 'kind': 'arrow', 'visualType': 'connector', 'x': 10, 'y': 20, 'width': 300,
                         'height': 100, 'color': '#2563eb', 'strokeWidth': 2, 'connector': {
                             'start': {'x': 10, 'y': 20}, 'end': {'x': 300, 'y': 100},
                             'from': {'object': {'kind': 'shape', 'id': 'note-a'}, 'u': .5, 'v': .5, 'auto': True},
                             'route': 'curve', 'startCap': 'circle', 'endCap': 'arrow', 'style': 'dash', 'label': 'explains'}}
            content = {'strokes': [], 'texts': [], 'media': [], 'shapes': [note, connector], 'camera': {'x': 0, 'y': 0, 'zoom': 1}}
            result = owner.put(f'/api/boards/{board}', json={'version': 0, 'content': content})
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual(viewer.get(f'/api/boards/{board}').json()['content'], content)
            self.assertEqual(viewer.put(f'/api/boards/{board}', json={'version': 1, 'content': content}).status_code, 403)
            snapshot = owner.post(f'/api/boards/{board}/history', json={'title': 'Phase one', 'expected_version': 1})
            self.assertEqual(snapshot.status_code, 201, snapshot.text)
            edited = copy.deepcopy(content)
            edited['shapes'][0]['note']['text'] = 'Edited by another contributor'
            self.assertEqual(editor.put(f'/api/boards/{board}', json={'version': 1, 'content': edited}).status_code, 200)
            invalid = copy.deepcopy(edited)
            invalid['shapes'][1]['connector']['route'] = 'execute-script'
            self.assertEqual(editor.put(f'/api/boards/{board}', json={'version': 2, 'content': invalid}).status_code, 422)
            self.assertEqual(owner.get(f'/api/boards/{board}').json()['content'], edited)
            restored = owner.post(f"/api/boards/{board}/history/{snapshot.json()['id']}/restore", json={'expected_version': 2})
            self.assertEqual(restored.status_code, 200, restored.text)
            self.assertEqual(owner.get(f'/api/boards/{board}').json()['content'], content)
            with TestClient(self.app, base_url='https://testserver') as outsider:
                outsider.post('/api/auth/guest', json={'name': 'Visual outsider', 'password': 'visual-password'})
                self.assertEqual(outsider.get(f'/api/boards/{board}').status_code, 403)

    def test_structured_matrices_preserve_old_vectors_and_reject_invalid_grids(self):
        import copy
        with TestClient(self.app, base_url='https://testserver') as client:
            client.post('/api/auth/guest', json={'name': 'Matrix validator', 'password': 'matrix-password'})
            board = client.post('/api/boards', json={'name': 'Matrices'}).json()['id']
            legacy = {'id': 'vector-old', 'kind': 'rectangle', 'visualType': 'symbol', 'symbol': 'vector',
                      'x': 0, 'y': 0, 'width': 100, 'height': 170, 'color': '#202020', 'strokeWidth': 2, 'label': 'x\ny\nz'}
            content = {'strokes': [], 'texts': [], 'media': [], 'shapes': [legacy]}
            self.assertEqual(client.put(f'/api/boards/{board}', json={'version': 0, 'content': content}).status_code, 200)
            matrix = copy.deepcopy(content)
            matrix['shapes'][0].update(symbol='matrix', matrix=[['1', '2'], ['3', '4']])
            self.assertEqual(client.put(f'/api/boards/{board}', json={'version': 1, 'content': matrix}).status_code, 200)
            self.assertEqual(client.get(f'/api/boards/{board}').json()['content'], matrix)
            for cells in ([['1'], ['2', '3']], [], [['x'*101]], [['1']]*13, [[1, 2]]):
                invalid = copy.deepcopy(matrix)
                invalid['shapes'][0]['matrix'] = cells
                self.assertEqual(client.put(f'/api/boards/{board}', json={'version': 2, 'content': invalid}).status_code, 422)
            self.assertEqual(client.get(f'/api/boards/{board}').json()['content'], matrix)

    def test_study_notes_preserve_full_answers_and_reject_invalid_content(self):
        import copy
        with TestClient(self.app, base_url='https://testserver') as client:
            client.post('/api/auth/guest', json={'name': 'Study notes validator', 'password': 'study-password'})
            board = client.post('/api/boards', json={'name': 'Tarjetas adhesivas'}).json()['id']
            study = {'question': 'Pregunta', 'answer': 'a'*20000, 'deck': 'General', 'face': 'answer'}
            note = {'id': 'study-note', 'kind': 'rectangle', 'visualType': 'sticky', 'x': 0, 'y': 0,
                    'width': 280, 'height': 230, 'color': '#b79b43', 'strokeWidth': 1,
                    'note': {'text': 'a'*10000, 'background': '#fff0a6', 'fontSize': 18, 'study': study}}
            content = {'strokes': [], 'texts': [], 'shapes': [note]}
            result = client.put(f'/api/boards/{board}', json={'version': 0, 'content': content})
            self.assertEqual(result.status_code, 200, result.text)
            for changes in ({'answer': 'x'*20001}, {'question': ''}, {'deck': 'x'*101},
                            {'face': 'invalid'}, {'alternatives': [{'question': 'q', 'answer': 123}]}):
                invalid = copy.deepcopy(content)
                invalid['shapes'][0]['note']['study'].update(changes)
                result = client.put(f'/api/boards/{board}', json={'version': 1, 'content': invalid})
                self.assertEqual(result.status_code, 422, result.text)
            self.assertEqual(client.get(f'/api/boards/{board}').json()['content'], content)

    def test_deck_notes_and_large_fractional_fonts_save_without_an_upper_font_limit(self):
        import copy
        with TestClient(self.app, base_url='https://testserver') as client:
            client.post('/api/auth/guest', json={'name': 'Deck validator', 'password': 'deck-password'})
            board = client.post('/api/boards', json={'name': 'Deck'}).json()['id']
            cards = [{'question': 'Q1', 'answer': 'A1', 'deck': 'General'}, {'question': 'Q2', 'answer': 'A2', 'deck': 'General'}]
            content = {'shapes': [{'id': 'deck-note', 'kind': 'rectangle', 'visualType': 'sticky', 'x': 0, 'y': 0,
                'width': 2000, 'height': 1700, 'color': '#b79b43', 'strokeWidth': 1,
                'note': {'text': 'Q1', 'background': '#fff0a6', 'fontSize': 135.5,
                         'study': {**cards[0], 'face': 'question', 'cards': cards, 'index': 0}}}]}
            result = client.put(f'/api/boards/{board}', json={'version': 0, 'content': content})
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual(client.get(f'/api/boards/{board}').json()['content'], content)
            for index in (-1, 2, .5, True):
                invalid = copy.deepcopy(content)
                invalid['shapes'][0]['note']['study']['index'] = index
                self.assertEqual(client.put(f'/api/boards/{board}', json={'version': 1, 'content': invalid}).status_code, 422)

    def test_judge0_proxy_requires_session_isolates_jobs_and_applies_limits(self):
        import base64, io, json
        from unittest.mock import patch
        token='12345678-abcd-1234-abcd-123456789012'
        # Judge0 uses Ruby's line-wrapped Base64 with a trailing newline.
        encode=lambda value: base64.encodebytes(value.encode()).decode()
        submitted=[]
        def fake(req,timeout):
            if req.method=='POST':
                submitted.append(json.loads(req.data))
                self.assertEqual(timeout,10)
                return io.BytesIO(json.dumps({'token':token}).encode())
            return io.BytesIO(json.dumps({'stdout':encode('Hola, mundo!\n'),'compile_output':None,
                'stderr':encode('error de ejemplo'),'message':None,'status':{'id':3,'description':'Accepted'},'time':'0.01','exit_code':0}).encode())
        with patch.dict(os.environ,{'JUDGE0_URL':'http://127.0.0.1:2358'}),patch('reconocimiento_local.judge0_api.urllib.request.urlopen',side_effect=fake):
            with TestClient(self.app,base_url='https://testserver') as client:
                self.assertEqual(client.post('/api/code/run',json={'source':'int main(){}'}).status_code,401)
                client.post('/api/auth/guest',json={'name':'Code owner','password':'code-password'})
                job=client.post('/api/code/run',json={'source':'int main(){}','stdin':'42'})
                self.assertEqual(job.status_code,200,job.text)
                self.assertFalse(submitted[0]['enable_network'])
                self.assertEqual(submitted[0]['cpu_time_limit'],2)
                self.assertEqual(submitted[0]['memory_limit'],262144)
                self.assertEqual(base64.b64decode(submitted[0]['source_code']).decode(),'int main(){}')
                result=client.get('/api/code/results/'+token)
                self.assertEqual(result.status_code,200,result.text)
                self.assertEqual(result.json()['stdout'],'Hola, mundo!\n')
                self.assertEqual(result.json()['stderr'],'error de ejemplo')
                with patch('reconocimiento_local.judge0_api.urllib.request.urlopen',return_value=io.BytesIO(json.dumps({'stdout':'!!!','status':{'id':3}}).encode())):
                    self.assertEqual(client.get('/api/code/results/'+token).status_code,502)
                compilation={'compile_output':encode('error: expected semicolon'),'status':{'id':6,'description':'Compilation Error'}}
                with patch('reconocimiento_local.judge0_api.urllib.request.urlopen',return_value=io.BytesIO(json.dumps(compilation).encode())):
                    failure=client.get('/api/code/results/'+token)
                    self.assertEqual(failure.status_code,200,failure.text)
                    self.assertEqual(failure.json()['compile_output'],'error: expected semicolon')
                for attempt in range(4):
                    self.assertEqual(client.post('/api/code/run',json={'source':'int main(){}'}).status_code,200)
                self.assertEqual(client.post('/api/code/run',json={'source':'int main(){}'}).status_code,429)
                self.assertEqual(client.post('/api/code/run',headers={'Origin':'https://evil.example'},json={'source':'x'}).status_code,403)
                client.cookies.clear()
                client.post('/api/auth/guest',json={'name':'Code other','password':'code-password'})
                self.assertEqual(client.get('/api/code/results/'+token).status_code,404)

    def test_judge0_unconfigured_reports_unavailable_without_running_code(self):
        from unittest.mock import patch
        with patch.dict(os.environ,{'JUDGE0_URL':''}),TestClient(self.app,base_url='https://testserver') as client:
            client.post('/api/auth/guest',json={'name':'Code offline','password':'code-password'})
            result=client.post('/api/code/run',json={'source':'int main(){}'})
            self.assertEqual(result.status_code,503,result.text)
            self.assertIn('instalado',result.json()['detail'])

    def test_html_content_is_shared_editable_and_validated(self):
        import copy
        with TestClient(self.app,base_url='https://testserver') as owner,TestClient(self.app,base_url='https://testserver') as member:
            for client,name in [(owner,'HTML owner'),(member,'HTML member')]:
                self.assertEqual(client.post('/api/auth/guest',json={'name':name,'password':'html-password'}).status_code,200)
            bid=owner.post('/api/boards',json={'name':'HTML compartido'}).json()['id']
            code=owner.post(f'/api/share/boards/{bid}/code',json={}).json()['code']
            self.assertEqual(member.post('/api/share/join-code',json={'code':code}).status_code,200)
            html={'id':'html-example','kind':'rectangle','visualType':'html','x':20,'y':30,'width':640,'height':440,'color':'#64748b','strokeWidth':1,'html':{'name':'ejercicio.html','source':'<button onclick="this.textContent=2">1</button>'}}
            content={'shapes':[html]}
            result=owner.put(f'/api/boards/{bid}',json={'version':0,'content':content})
            self.assertEqual(result.status_code,200,result.text)
            self.assertEqual(member.get(f'/api/boards/{bid}').json()['content'],content)
            html['x']=100
            self.assertEqual(member.put(f'/api/boards/{bid}',json={'version':1,'content':content}).status_code,200)
            self.assertEqual(owner.get(f'/api/boards/{bid}').json()['content'],content)
            for field,value in [('source','x'*1_000_001),('name','')]:
                bad=copy.deepcopy(content);bad['shapes'][0]['html'][field]=value
                self.assertEqual(owner.put(f'/api/boards/{bid}',json={'version':2,'content':bad}).status_code,422)

    def test_html_presence_is_bounded_and_allowed_for_viewers(self):
        with TestClient(self.app,base_url='https://testserver') as client:
            client.post('/api/auth/guest',json={'name':'HTML presence owner','password':'html-password'})
            board=client.post('/api/boards',json={'name':'HTML presence'}).json()['id']
            token=client.post(f'/api/share/boards/{board}',json={'role':'viewer','days':1}).json()['token']
            with client.websocket_connect(f'wss://testserver/api/live/{board}') as a:
                a.receive_json();a.receive_json()
                client.cookies.clear()
                person=client.post('/api/auth/guest',json={'name':'HTML presence reader','password':'html-password'}).json()
                client.post('/api/share/join',json={'token':token})
                with client.websocket_connect(f'wss://testserver/api/live/{board}') as b:
                    b.receive_json();b.receive_json();a.receive_json()
                    b.send_json({'type':'cursor_move','point':{'x':100,'y':200},'html_id':'html-widget','html_action':'interact','html_source':'not forwarded','name':'Spoofed'})
                    event=a.receive_json()
                    self.assertEqual(event['html_id'],'html-widget');self.assertEqual(event['html_action'],'interact')
                    self.assertEqual(event['user_id'],person['id']);self.assertNotEqual(event['name'],'Spoofed')
                    self.assertNotIn('html_source',event)
                    b.send_json({'type':'cursor_move','point':{'x':100,'y':200},'html_id':'a'*81,'html_action':'interact'})
                    self.assertNotIn('html_id',a.receive_json())

    def test_live_html_has_one_executor_bounded_input_and_late_join_state(self):
        with TestClient(self.app,base_url='https://testserver') as client:
            client.post('/api/auth/guest',json={'name':'HTML live owner','password':'html-password'})
            board=client.post('/api/boards',json={'name':'HTML live'}).json()['id']
            token=client.post(f'/api/share/boards/{board}',json={'role':'editor'}).json()['token']
            viewer=client.post(f'/api/share/boards/{board}',json={'role':'viewer'}).json()['token']
            content={'shapes':[{'id':'html-live','kind':'rectangle','visualType':'html','x':0,'y':0,'width':640,'height':440,'color':'#64748b','strokeWidth':1,'html':{'name':'live.html','source':'<button>1</button>'}}]}
            self.assertEqual(client.put(f'/api/boards/{board}',json={'version':0,'content':content}).status_code,200)
            with client.websocket_connect(f'wss://testserver/api/live/{board}') as a:
                a.receive_json();a.receive_json()
                client.cookies.clear()
                client.post('/api/auth/guest',json={'name':'HTML live member','password':'html-password'})
                client.post('/api/share/join',json={'token':token})
                with client.websocket_connect(f'wss://testserver/api/live/{board}') as b:
                    b.receive_json();b.receive_json();a.receive_json()
                    a.send_json({'type':'html_start','html_id':'missing','request':'missing'})
                    self.assertTrue(a.receive_json()['retry'])
                    a.send_json({'type':'html_start','html_id':'html-live','request':'session-a'})
                    session=a.receive_json();self.assertEqual(session['type'],'html_session')
                    self.assertEqual(b.receive_json()['session'],'session-a')
                    b.send_json({'type':'html_start','html_id':'html-live','request':'session-b'})
                    self.assertEqual(b.receive_json()['session'],'session-a')
                    document='<html><body><button data-pizarra-node="5">Matemática 🙂</button></body></html>'
                    a.send_json({'type':'html_frame','html_id':'html-live','session':'session-a','base':0,'prefix':0,'remove':0,'text':document})
                    self.assertEqual(b.receive_json()['revision'],1)
                    b.send_json({'type':'html_frame','html_id':'html-live','session':'session-a','base':1,'prefix':0,'remove':0,'text':'not owner'})
                    b.send_json({'type':'html_input','html_id':'html-live','session':'session-a','event':{'action':'input','node':'5','value':'x'*8001}})
                    b.send_json({'type':'html_input','html_id':'html-live','session':'session-a','event':{'action':'click','node':'5','name':'spoof','source':'not forwarded','x':.5}})
                    event=a.receive_json();self.assertEqual(event['type'],'html_input')
                    self.assertEqual(event['event'],{'action':'click','node':'5','x':.5})
                    b.send_json({'type':'html_request','html_id':'html-live'})
                    self.assertEqual(b.receive_json()['document'],document)
                    client.cookies.clear()
                    client.post('/api/auth/guest',json={'name':'HTML live viewer','password':'html-password'})
                    client.post('/api/share/join',json={'token':viewer})
                    with client.websocket_connect(f'wss://testserver/api/live/{board}') as c:
                        c.receive_json();c.receive_json();a.receive_json();b.receive_json()
                        cached=c.receive_json();self.assertEqual(cached['document'],document)
                        c.send_json({'type':'html_stop','html_id':'html-live','session':'session-a'})
                        c.send_json({'type':'html_input','html_id':'html-live','session':'session-a','event':{'action':'click','node':'5'}})
                        c.send_json({'type':'cursor_move','point':{'x':0,'y':0}})
                        self.assertEqual(a.receive_json()['type'],'cursor_move');b.receive_json()
                        b.send_json({'type':'html_stop','html_id':'html-live','session':'session-a'})
                        for peer in [a,b,c]:
                            self.assertFalse(peer.receive_json()['running'])

    def test_printable_pages_cartesian_and_code_save_with_validation(self):
        import copy
        with TestClient(self.app,base_url='https://testserver') as client:
            client.post('/api/auth/guest',json={'name':'Academic pages','password':'page-password'})
            bid=client.post('/api/boards',json={'name':'Pages'}).json()['id']
            shape={'id':'sheet','kind':'rectangle','visualType':'page','x':0,'y':0,'width':210,'height':297,'strokeWidth':1,'color':'#94a3b8'}
            code={**shape,'id':'cpp','visualType':'code','code':{'source':'int main(){}','stdin':'','output':'ok','status':'Accepted'}}
            grid={**shape,'id':'grid','visualType':'symbol','symbol':'cartesian'}
            content={'shapes':[shape,code,grid]}
            result=client.put('/api/boards/'+bid,json={'version':0,'content':content})
            self.assertEqual(result.status_code,200,result.text)
            self.assertEqual(client.get('/api/boards/'+bid).json()['content'],content)
            bad=copy.deepcopy(content);bad['shapes'][0]['height']=100
            self.assertEqual(client.put('/api/boards/'+bid,json={'version':1,'content':bad}).status_code,422)
            bad=copy.deepcopy(content);bad['shapes'][1]['code']['source']='x'*100001
            self.assertEqual(client.put('/api/boards/'+bid,json={'version':1,'content':bad}).status_code,422)

    def test_ink_commit_and_deletion_acknowledgements_survive_reconnect(self):
        with TestClient(self.app,base_url='https://testserver') as client:
            client.post('/api/auth/guest',json={'name':'Ink acknowledgements','password':'ink-password'})
            board=client.post('/api/boards',json={'name':'Ink acknowledgements'}).json()['id']
            stroke={'id':'ack-ink','points':[{'x':1,'y':2},{'x':3,'y':4}],'color':'#000000','width':3,'highlighter':True}
            with client.websocket_connect(f'wss://testserver/api/live/{board}') as a:
                a.receive_json();a.receive_json()
                with client.websocket_connect(f'wss://testserver/api/live/{board}') as b:
                    b.receive_json();b.receive_json();a.receive_json()
                    a.send_json({'type':'stroke_start','stroke_id':stroke['id'],'point':stroke['points'][0],'color':stroke['color'],'width':3,'highlighter':True})
                    self.assertTrue(b.receive_json()['highlighter'])
                    a.send_json({'type':'stroke_end','stroke_id':stroke['id']})
                    self.assertEqual(b.receive_json()['type'],'stroke_end')
                    self.assertEqual(client.put(f'/api/boards/{board}',json={'version':0,'content':{'strokes':[stroke]}}).status_code,200)
                    for peer in (a,b):
                        self.assertEqual(peer.receive_json()['type'],'board_version')
                        settled=peer.receive_json();self.assertEqual(settled['saved'],['ack-ink']);self.assertEqual(settled['version'],1)
                        peer.receive_json() # presence
                    self.assertEqual(client.put(f'/api/boards/{board}',json={'version':1,'content':{'strokes':[]}}).status_code,200)
                    for peer in (a,b):
                        peer.receive_json()
                        settled=peer.receive_json();self.assertEqual(settled['removed'],['ack-ink']);self.assertEqual(settled['version'],2)
                        peer.receive_json()
                with client.websocket_connect(f'wss://testserver/api/live/{board}') as reconnected:
                    reconnected.receive_json();reconnected.receive_json()
                    settled=reconnected.receive_json()
                    self.assertEqual(settled['type'],'ink_settled');self.assertEqual(settled['version'],2)
                    self.assertEqual(settled['removed'],['ack-ink']);self.assertEqual(settled['saved'],[])

    def test_contributor_edits_and_camera_presence(self):
        with TestClient(self.app, base_url='https://testserver') as client:
            owner = client.post('/api/auth/guest', json={
                'name': 'Camera owner', 'password': 'camera-password'}).json()
            board = client.post('/api/boards', json={'name': 'Collaboration'}).json()['id']
            token = client.post(f'/api/share/boards/{board}', json={'role': 'editor'}).json()['token']
            content = {'strokes': [{'id': 'a-stroke', 'points': [{'x': 1, 'y': 2}], 'width': 3, 'color': '#202020'}],
                       'texts': [], 'media': [], 'camera': {'x': 0, 'y': 0, 'zoom': 1}}
            self.assertEqual(client.put(f'/api/boards/{board}', json={'version': 0, 'content': content}).status_code, 200)
            with client.websocket_connect(f'wss://testserver/api/live/{board}') as a:
                a.receive_json()
                a.receive_json()
                if self.cloud_schema:
                    self.assertEqual(a.receive_json()['type'],'ink_settled')
                a.send_json({'type': 'camera_move', 'center': {'x': 400, 'y': 500}, 'zoom': 2})
                client.cookies.clear()
                other = client.post('/api/auth/guest', json={
                    'name': 'Camera editor', 'password': 'editor-password'}).json()
                self.assertEqual(client.post('/api/share/join', json={'token': token}).status_code, 200)
                with client.websocket_connect(f'wss://testserver/api/live/{board}') as b:
                    b.receive_json()
                    presence = b.receive_json()
                    if self.cloud_schema:
                        self.assertEqual(b.receive_json()['type'],'ink_settled')
                    owner_view = next(u['view'] for u in presence['users'] if u['id'] == owner['id'])
                    self.assertEqual(owner_view, {'center': {'x': 400, 'y': 500}, 'zoom': 2})
                    a.receive_json()  # New participant.
                    b.send_json({'type': 'camera_move', 'center': {'x': 50, 'y': 60}, 'zoom': 100})
                    b.send_json({'type': 'camera_move', 'center': {'x': 50, 'y': 60}, 'zoom': 1.5,'viewport':{'width':800,'height':1100},'following':owner['id']})
                    event = a.receive_json()
                    self.assertEqual(event['type'], 'camera_move')
                    self.assertEqual(event['zoom'], 1.5)
                    self.assertEqual(event['user_id'], other['id'])
                    self.assertEqual(event['viewport'],{'width':800,'height':1100})
                    self.assertEqual(event['following'],owner['id'])
                    # An editor may erase content originally committed by the owner.
                    content['strokes'] = []
                    result = client.put(f'/api/boards/{board}', json={'version': 1, 'content': content})
                    self.assertEqual(result.status_code, 200, result.text)
                    self.assertEqual(a.receive_json()['version'], 2)
                    self.assertEqual(b.receive_json()['version'], 2)
                    self.assertEqual(client.get(f'/api/boards/{board}').json()['content']['strokes'], [])

if __name__ == '__main__':
    unittest.main()
