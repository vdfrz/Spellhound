"""Private WSGI interface; deliberately not mounted by server/start.mjs."""
import json
from http import HTTPStatus
from urllib.parse import parse_qs
from .store import Matters, Problem

PREFIX = '/spellhound/matters'


def response(start, status, data):
    body = json.dumps(data).encode()
    start(f'{status} {HTTPStatus(status).phrase}', [('Content-Type', 'application/json'),
          ('Content-Length', str(len(body))), ('Cache-Control', 'no-store'), ('X-Content-Type-Options', 'nosniff')])
    return [body]


def payload(env, keys):
    if env.get('CONTENT_TYPE', '').split(';')[0] != 'application/json':
        raise Problem(415, 'Send JSON.')
    try:
        size = int(env.get('CONTENT_LENGTH') or 0)
        if size < 1 or size > 768000:
            raise Problem(413, 'Request size is outside the allowed range.')
        data = json.loads(env['wsgi.input'].read(size))
    except (UnicodeError, ValueError, RecursionError):
        raise Problem(400, 'Invalid JSON.') from None
    if not isinstance(data, dict) or set(data) != set(keys):
        raise Problem(400, 'Unexpected request fields.')
    return data


def private_api(root, resolve_principal, origin, memory=None):
    def handle(env, start):
        try:
            store = Matters(root, resolve_principal(env), memory)
            method, path = env['REQUEST_METHOD'], env['PATH_INFO']
            if method not in ('POST', 'GET'):
                raise Problem(405, 'Method not supported.')
            if method == 'POST' and env.get('HTTP_ORIGIN') != origin:
                raise Problem(403, 'Open the matter workspace to file an item.')
            if path == PREFIX:
                if method == 'GET':
                    return response(start, 200, store.list())
                return response(start, 201, store.create(**payload(env, ['name'])))
            parts = path.split('/')
            if len(parts) != 5 or '/'.join(parts[:3]) != PREFIX:
                raise Problem(404, 'Not found.')
            mid, action = parts[3:]
            if action == 'entries':
                if method == 'GET':
                    kinds = parse_qs(env.get('QUERY_STRING', ''), keep_blank_values=True).get('kind')
                    if kinds and (len(kinds) != 1 or kinds[0] not in ('note', 'reference', 'decision')):
                        raise Problem(400, 'Unknown item type.')
                    return response(start, 200, store.entries(mid, kinds[0] if kinds else None))
                return response(start, 201, store.file(mid, **payload(env, ['kind', 'title', 'body'])))
            if action == 'memory':
                if method == 'GET':
                    return response(start, 200, store.experience(mid))
                decision_id = payload(env, ['decisionId'])['decisionId']
                if not isinstance(decision_id, str):
                    raise Problem(400, 'Select a filed decision.')
                return response(start, 200, store.experience(mid, decision_id))
            raise Problem(404, 'Not found.')
        except Problem as e:
            return response(start, e.status, {'error': str(e)})
        except Exception:
            return response(start, 500, {'error': 'Could not open the workspace. Please retry.'})
    return handle
