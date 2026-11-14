"""Exercise the real SDK, SQLite and Chroma; only the HTTP model responses are synthetic."""
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from importlib.metadata import version
from pathlib import Path
from .fixture import ModelFixture
from .memory import hy_memory
from .store import Matters, Principal


class MemoryRegression(unittest.TestCase):
    def test_saved_experiences_are_isolated_after_restart(self):
        self.assertEqual(version('hy-memory'), '2.0.16', 'Install server/matters/requirements.txt')
        with tempfile.TemporaryDirectory() as tmp, ThreadingHTTPServer(('127.0.0.1',0), ModelFixture) as http:
            thread = threading.Thread(target=http.serve_forever, daemon=True)
            thread.start()
            try:
                adapter = hy_memory(base_url=f'http://127.0.0.1:{http.server_port}/v1', chat_model='fixture',
                                    embedding_model='fixture', dimensions=8, api_key='synthetic')
                def reopen():
                    return Matters(Path(tmp), Principal('fixture:owner'), adapter)
                matters = reopen()
                pairs = []
                for canary in ('AZURE-CANARY', 'OCHRE-CANARY'):
                    mid = matters.create('Same display name')['id']
                    decision = matters.file(mid, 'decision', 'Synthetic position', canary)
                    memories = matters.experience(mid, decision['id'])
                    self.assertEqual([m['body'] for m in memories], [canary])
                    pairs.append((mid, canary))
                for mid, canary in pairs:
                    self.assertEqual([m['body'] for m in reopen().experience(mid)], [canary])
            finally:
                http.shutdown()
                thread.join()
