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


if __name__ == '__main__':
    unittest.main()
