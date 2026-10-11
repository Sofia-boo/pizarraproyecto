"""Integration checks against isolated storage, never the user's database."""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient


class BackendTest(unittest.TestCase):
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

    def test_datalab_transcribes_whole_document_keeps_private_jobs_and_reports_failed_pages(self):
        import httpx
        from unittest.mock import patch
        calls=[]
        def handler(request):
            calls.append(request)
            self.assertEqual(request.headers.get('X-API-Key'),'private-test-key')
            if request.method=='POST':
                self.assertNotIn(b'max_pages',request.content)
                self.assertIn(b'accurate',request.content)
                return httpx.Response(200,json={'success':True,'request_check_url':'https://www.datalab.to/api/v1/convert/test-job'})
            return httpx.Response(200,json={'status':'complete','success':True,'markdown':'# Página 1\nTexto completo\n\n# Página 3\nFinal','page_count':3,'metadata':{'failed_pages':[1]}})
        client_class=httpx.AsyncClient
        factory=lambda **kwargs: client_class(transport=httpx.MockTransport(handler),**kwargs)
        with TestClient(self.app,base_url='https://testserver') as a, TestClient(self.app,base_url='https://testserver') as b:
            self.assertEqual(a.post('/api/ocr/documents',files={'file':('test.pdf',b'%PDF-test','application/pdf')}).status_code,401)
            a.post('/api/auth/guest',json={'name':'OCR owner','password':'test-password'})
            b.post('/api/auth/guest',json={'name':'OCR outsider','password':'test-password'})
            with patch.dict(os.environ,{'DATALAB_API_KEY':'','ocrkey':''}):
                self.assertEqual(a.post('/api/ocr/documents',files={'file':('test.pdf',b'%PDF-test','application/pdf')}).status_code,503)
            with patch.dict(os.environ,{'DATALAB_API_KEY':'private-test-key'}),patch('reconocimiento_local.datalab_api.httpx.AsyncClient',side_effect=factory):
                response=a.post('/api/ocr/documents',files={'file':('test.pdf',b'%PDF-test','application/pdf')})
                self.assertEqual(response.status_code,200,response.text)
                job=response.json()['id']
                self.assertNotIn('private-test-key',response.text)
                self.assertEqual(b.get('/api/ocr/documents/'+job).status_code,404)
                result=a.get('/api/ocr/documents/'+job)
                self.assertEqual(result.status_code,200,result.text)
                self.assertIn('Final',result.json()['text'])
                self.assertEqual(result.json()['failed_pages'],[1])
                self.assertIn('2',result.json()['warning'])
                self.assertEqual(a.get('/api/ocr/documents/'+job).json(),result.json())
                self.assertEqual(len(calls),2)

    def test_ocr_pairing_is_private_expires_and_cannot_be_reused(self):
        import json,hashlib,time
        from unittest.mock import patch
        directory=Path(self.storage.name)
        pairing=directory/'ocr_pairing.json'
        target=directory/'datalab.json'
        ticket='a'*64
        def prepare(expires):
            pairing.write_text(json.dumps({'digest':hashlib.sha256(ticket.encode()).hexdigest(),'expires':expires}),encoding='utf-8')
        try:
            with TestClient(self.app,base_url='https://testserver') as client, patch.dict(os.environ,{'DATALAB_API_KEY':'','ocrkey':''}):
                payload={'ticket':ticket,'api_key':'private-pairing-test-key'}
                self.assertEqual(client.post('/api/ocr/setup-private',json=payload).status_code,403)
                prepare(time.time()+60)
                self.assertEqual(client.post('/api/ocr/setup-private',json={**payload,'ticket':'b'*64}).status_code,403)
                self.assertFalse(target.exists())
                prepare(time.time()-1)
                self.assertEqual(client.post('/api/ocr/setup-private',json=payload).status_code,403)
                prepare(time.time()+60)
                linked=client.post('/api/ocr/setup-private',json=payload)
                self.assertEqual(linked.status_code,200,linked.text)
                self.assertEqual(linked.json(),{'configured':True})
                self.assertFalse(pairing.exists())
                self.assertEqual(json.loads(target.read_text())['api_key'],payload['api_key'])
                self.assertEqual(client.post('/api/ocr/setup-private',json=payload).status_code,403)
                self.assertEqual(client.get('/api/ocr/status').status_code,401)
                client.post('/api/auth/guest',json={'name':'Pairing status','password':'test-password'})
                self.assertEqual(client.get('/api/ocr/status').json(),{'configured':True})
                self.assertEqual(client.get('/api/ocr/setup-private').status_code,405)
        finally:
            pairing.unlink(missing_ok=True);target.unlink(missing_ok=True)

    def test_ocr_accepts_vercel_key_name_and_image_without_exposing_secrets(self):
        import httpx
        from unittest.mock import patch
        client_class=httpx.AsyncClient
        def handler(request):
            self.assertEqual(request.headers['X-API-Key'],'private-vercel-test-key')
            self.assertIn(b'image/png',request.content)
            self.assertIn(b'fast',request.content)
            self.assertNotIn(b'accurate',request.content)
            self.assertIn(b'name="paginate"\r\n\r\nfalse',request.content)
            self.assertIn(b'disable_image_captions',request.content)
            return httpx.Response(200,json={'success':True,'request_check_url':'https://www.datalab.to/api/v1/convert/image-job'})
        with TestClient(self.app,base_url='https://testserver') as client,patch.dict(os.environ,{'DATALAB_API_KEY':'','ocrkey':'private-vercel-test-key'}),patch('reconocimiento_local.datalab_api.httpx.AsyncClient',side_effect=lambda **kwargs:client_class(transport=httpx.MockTransport(handler),**kwargs)):
            client.post('/api/auth/guest',json={'name':'Image OCR','password':'test-password'})
            result=client.post('/api/ocr/documents',files={'file':('manuscrito.png',b'\x89PNG-test','image/png')})
            self.assertEqual(result.status_code,200,result.text)
            self.assertNotIn('private-vercel-test-key',result.text)
            self.assertNotIn('datalab.to',result.text)

    def test_ocr_precision_override_and_invalid_modes(self):
        import httpx
        from unittest.mock import patch
        client_class=httpx.AsyncClient
        calls=[]
        def handler(request):
            calls.append(request)
            self.assertIn(b'accurate',request.content)
            return httpx.Response(200,json={'success':True,'request_check_url':'https://www.datalab.to/api/v1/convert/precise-image'})
        with TestClient(self.app,base_url='https://testserver') as client,patch.dict(os.environ,{'DATALAB_API_KEY':'private-test-key'}),patch('reconocimiento_local.datalab_api.httpx.AsyncClient',side_effect=lambda **kwargs:client_class(transport=httpx.MockTransport(handler),**kwargs)):
            client.post('/api/auth/guest',json={'name':'Precise OCR','password':'test-password'})
            file={'file':('test.png',b'\x89PNG-test','image/png')}
            self.assertEqual(client.post('/api/ocr/documents',files=file,data={'mode':'accurate'}).status_code,200)
            self.assertEqual(client.post('/api/ocr/documents',files=file,data={'mode':'unlimited'}).status_code,422)
            self.assertEqual(len(calls),1)

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
            "from reconocimiento_local.server import db_connection; "
            "db=db_connection(); "
            "assert db.execute('SELECT content FROM boards WHERE id=?', (__import__('sys').argv[1],)).fetchone(); "
            "db.close()", board_id], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((Path(self.storage.name) / 'letter_samples.json').is_file())
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

    def test_local_handwriting_routes_recognize_seed_strokes_without_training_real_data(self):
        import json
        from reconocimiento_local import server
        def ink(sample):
            return {'strokes': [{'width': 3, 'points': [{'x': x*100+10, 'y': y*100+20} for x, y in path]}
                                for path in sample['stroke_paths']]}
        with TestClient(self.app, base_url='https://testserver') as client:
            client.post('/api/auth/guest', json={'name': 'Handwriting validator', 'password': 'ink-password'})
            letters = json.loads(server.LETTER_DATA.read_text(encoding='utf-8'))
            letter = next(s for s in letters if s.get('stroke_paths'))
            for route in ('letters', 'words', 'text-local', 'calendar-handwriting'):
                result = client.post('/recognize/'+route, json=ink(letter))
                self.assertEqual(result.status_code, 200, result.text)
                self.assertTrue(result.json()['text'])
            math_file = Path(self.storage.name)/'math_samples.json'
            sample = next(s for s in json.loads(math_file.read_text(encoding='utf-8')) if s.get('stroke_paths'))
            before = math_file.read_bytes()
            for route in ('math-symbols', 'math-local'):
                result = client.post('/recognize/'+route, json=ink(sample))
                self.assertEqual(result.status_code, 200, result.text)
                self.assertTrue(result.json()['text'])
            self.assertEqual(client.post('/recognize/math-symbols/train', json={**ink(sample), 'label': '3'}).status_code, 403)
            self.assertEqual(math_file.read_bytes(), before)

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
                a.send_json({'type': 'camera_move', 'center': {'x': 400, 'y': 500}, 'zoom': 2})
                client.cookies.clear()
                other = client.post('/api/auth/guest', json={
                    'name': 'Camera editor', 'password': 'editor-password'}).json()
                self.assertEqual(client.post('/api/share/join', json={'token': token}).status_code, 200)
                with client.websocket_connect(f'wss://testserver/api/live/{board}') as b:
                    b.receive_json()
                    presence = b.receive_json()
                    owner_view = next(u['view'] for u in presence['users'] if u['id'] == owner['id'])
                    self.assertEqual(owner_view, {'center': {'x': 400, 'y': 500}, 'zoom': 2})
                    a.receive_json()  # New participant.
                    b.send_json({'type': 'camera_move', 'center': {'x': 50, 'y': 60}, 'zoom': 100})
                    b.send_json({'type': 'camera_move', 'center': {'x': 50, 'y': 60}, 'zoom': 1.5})
                    event = a.receive_json()
                    self.assertEqual(event['type'], 'camera_move')
                    self.assertEqual(event['zoom'], 1.5)
                    self.assertEqual(event['user_id'], other['id'])
                    # An editor may erase content originally committed by the owner.
                    content['strokes'] = []
                    result = client.put(f'/api/boards/{board}', json={'version': 1, 'content': content})
                    self.assertEqual(result.status_code, 200, result.text)
                    self.assertEqual(a.receive_json()['version'], 2)
                    self.assertEqual(b.receive_json()['version'], 2)
                    self.assertEqual(client.get(f'/api/boards/{board}').json()['content']['strokes'], [])

if __name__ == '__main__':
    unittest.main()
