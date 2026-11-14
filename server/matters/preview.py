"""Single-user, loopback-only, disposable synthetic demo. No production resolver."""
import mimetypes
import secrets
import tempfile
import threading
from pathlib import Path
from http.server import ThreadingHTTPServer
from wsgiref.simple_server import make_server
from .api import PREFIX, private_api, response
from .memory import hy_memory
from .store import Principal
from .fixture import ModelFixture


def main():
    assets = Path('.spellhound/matter-preview').resolve()
    if not (assets / 'preview.html').is_file():
        raise SystemExit('Build the preview first: npm run build:matters-preview')
    with tempfile.TemporaryDirectory(prefix='spellhound-synthetic-') as root, ThreadingHTTPServer(('127.0.0.1', 0), ModelFixture) as models:
        threading.Thread(target=models.serve_forever, daemon=True).start()
        sid = secrets.token_urlsafe(32)
        def resolve(env):
            return Principal('fixture:preview') if f'matter_fixture={sid}' in env.get('HTTP_COOKIE','').split('; ') else None
        def app(env, start):
            if env.get('HTTP_HOST') != host:
                return response(start, 403, {'error': 'Local preview only.'})
            path = env['PATH_INFO']
            if path.startswith(PREFIX):
                return api(env, start)
            if env['REQUEST_METHOD'] != 'GET':
                return response(start, 405, {'error': 'Use GET.'})
            file = (assets / ('preview.html' if path == '/' else path.lstrip('/'))).resolve()
            if assets not in file.parents or not file.is_file():
                return response(start, 404, {'error': 'Not found.'})
            headers = [('Cache-Control','no-store'), ('Content-Type', mimetypes.guess_type(file)[0] or 'application/octet-stream'),
                       ('Content-Security-Policy', "frame-ancestors 'none'; default-src 'self'; style-src 'self' 'unsafe-inline'")]
            if path == '/':
                headers.append(('Set-Cookie', f'matter_fixture={sid}; HttpOnly; SameSite=Strict; Path=/'))
            start('200 OK', headers)
            return [file.read_bytes()]
        with make_server('127.0.0.1', 0, app) as server:
            host = f'127.0.0.1:{server.server_port}'
            origin = f'http://{host}'
            memory = hy_memory(base_url=f'http://127.0.0.1:{models.server_port}/v1', chat_model='fixture',
                               embedding_model='fixture', dimensions=8, api_key='synthetic')
            api = private_api(root, resolve, origin, memory)
            print(f'Open {origin}/ · synthetic data only · Ctrl+C to discard.', flush=True)
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                pass
            finally:
                models.shutdown()


if __name__ == '__main__':
    main()
