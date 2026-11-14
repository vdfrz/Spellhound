import io
import json
import tempfile
import unittest
from pathlib import Path
from .api import PREFIX, private_api
from .store import Principal


class WorkspaceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.calls = []
        self.sessions = {'session-one': Principal('synthetic:alice'), 'other-device': Principal('synthetic:alice'),
                         'session-two': Principal('synthetic:bob')}
        def memory(path, identity, entry):
            self.calls.append((path, identity, entry))
            return []
        self.api = private_api(Path(self.tmp.name), lambda env: self.sessions.get(env.get('HTTP_COOKIE')), 'https://fixture.invalid', memory)

    def call(self, path='', data=None, cookie='session-one', origin='https://fixture.invalid', status=200):
        raw = json.dumps(data).encode() if data is not None else b''
        env = {'PATH_INFO': PREFIX + path, 'REQUEST_METHOD': 'POST' if raw else 'GET', 'HTTP_COOKIE': cookie,
               'HTTP_ORIGIN': origin, 'CONTENT_TYPE': 'application/json', 'CONTENT_LENGTH': str(len(raw)),
               'wsgi.input': io.BytesIO(raw), 'HTTP_X_USER_ID': 'synthetic:alice'}
        meta = []
        result = json.loads(b''.join(self.api(env, lambda code, headers: meta.append((code, dict(headers))))))
        self.assertEqual(int(meta[0][0].split()[0]), status, result)
        self.assertEqual(meta[0][1]['Cache-Control'], 'no-store')
        return result

    def test_reopen_and_authorization(self):
        a, b = [self.call(data={'name': 'A synthetic matter'}, status=201)['id'] for _ in range(2)]
        for kind in ('note', 'reference', 'decision'):
            entry = self.call(f'/{a}/entries', {'kind': kind, 'title': kind, 'body': 'Only in A'}, status=201)
        self.assertEqual(len(self.call(f'/{a}/entries', cookie='other-device')), 3)
        self.assertEqual(self.call(f'/{b}/entries'), [])
        self.assertEqual(self.call(cookie='session-two'), [])
        self.call(cookie='not-authenticated', status=401)
        for path, data in [('entries', None), ('entries', {'kind':'note','title':'x','body':'x'}),
                           ('memory', None), ('memory', {'decisionId': entry['id']})]:
            self.call(f'/{a}/{path}', data, cookie='session-two', status=404)
        self.call(f'/{b}/memory', {'decisionId': entry['id']}, status=404)
        self.call(data={'name':'x'}, origin='https://elsewhere.invalid', status=403)
        self.call(data={'name':'x', 'owner':'synthetic:alice'}, status=400)
        self.assertFalse(self.calls)
        self.call(f'/{a}/memory', {'decisionId': entry['id']})
        self.call(f'/{b}/memory')
        self.assertNotEqual(self.calls[0][0], self.calls[1][0])
        self.assertNotEqual(self.calls[0][1], self.calls[1][1])
