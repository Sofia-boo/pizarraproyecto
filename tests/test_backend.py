"""Integration checks against isolated storage, never the user's database."""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient


class BackendTest(unittest.TestCase):
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
