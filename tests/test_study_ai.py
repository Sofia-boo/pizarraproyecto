import json
import os
import unittest
from unittest.mock import patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient
from reconocimiento_local.study_ai import attach_study_ai


class StudyAITest(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        @app.middleware('http')
        async def login(request, call_next):
            if request.headers.get('x-test-user'):
                request.state.user_id = 'test-user'
            return await call_next(request)
        attach_study_ai(app)
        self.client = TestClient(app)
        self.headers = {'x-test-user': 'yes'}

    def test_requires_session_and_server_key(self):
        with patch.dict(os.environ, {'GEMINI_API_KEY': ''}):
            self.assertEqual(self.client.post('/api/study-ai/consult', data={'prompt': '1+1'}).status_code, 401)
            self.assertFalse(self.client.get('/api/study-ai/status').json()['configured'])
            self.assertEqual(self.client.post('/api/study-ai/consult', headers=self.headers, data={'prompt': '1+1'}).status_code, 503)

    def test_sends_image_pdf_and_context_with_private_key(self):
        captured = []
        def provider(request):
            captured.append(request)
            return httpx.Response(200, json={'candidates': [{'content': {'parts': [{'text': 'Resultado: \\(2\\)'}]}}]})
        original = httpx.AsyncClient
        with patch.dict(os.environ, {'GEMINI_API_KEY': 'private-test-key'}), patch('reconocimiento_local.study_ai.httpx.AsyncClient', side_effect=lambda **kwargs: original(transport=httpx.MockTransport(provider), **kwargs)):
            response = self.client.post('/api/study-ai/consult', headers=self.headers,
                data={'prompt': 'Resolvé', 'history': json.dumps([{'role': 'user', 'text': 'Hola'}, {'role': 'assistant', 'text': 'Hola'}])},
                files=[('files', ('exercise.png', b'fake-image', 'image/png')), ('files', ('notes.pdf', b'%PDF-test', 'application/pdf'))])
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('private-test-key', response.text)
        payload = json.loads(captured[0].content)
        self.assertEqual(captured[0].headers['x-goog-api-key'], 'private-test-key')
        self.assertEqual(payload['contents'][1]['role'], 'model')
        self.assertEqual(payload['contents'][-1]['parts'][1]['inline_data']['mime_type'], 'image/png')
        self.assertEqual(payload['contents'][-1]['parts'][2]['inline_data']['mime_type'], 'application/pdf')

    def test_limits_and_provider_errors_do_not_retry_or_expose_provider_body(self):
        with patch.dict(os.environ, {'GEMINI_API_KEY': 'private-test-key'}):
            invalid = self.client.post('/api/study-ai/consult', headers=self.headers, data={'prompt': 'x', 'history': '{}'})
            self.assertEqual(invalid.status_code, 422)
            oversized = self.client.post('/api/study-ai/consult', headers=self.headers, data={'prompt': 'x'}, files={'files': ('huge.png', b'x'*3000001, 'image/png')})
            self.assertEqual(oversized.status_code, 413)
            original = httpx.AsyncClient
            for code in (429, 403, 503):
                calls = []
                def provider(request):
                    calls.append(request)
                    return httpx.Response(code, text='secret provider detail')
                with patch('reconocimiento_local.study_ai.httpx.AsyncClient', side_effect=lambda **kwargs: original(transport=httpx.MockTransport(provider), **kwargs)):
                    response = self.client.post('/api/study-ai/consult', headers=self.headers, data={'prompt': 'x'})
                self.assertEqual(response.status_code, 429 if code == 429 else 502)
                self.assertEqual(len(calls), 1)
                self.assertNotIn('secret provider detail', response.text)

if __name__ == '__main__':
    unittest.main()
