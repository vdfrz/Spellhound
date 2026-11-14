"""Loopback model stand-in for the demo and SDK regression. No external calls."""
import base64
import json
import re
from http.server import BaseHTTPRequestHandler


class ModelFixture(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if self.path == '/v1/chat/completions':
            prompt = '\n'.join(m['content'] for m in req['messages'])
            # Include *every* canary in the model context: a mixed history produces
            # a mixed saved experience, even if reads later filter by workspace.
            body = ' '.join(word for word in ('AZURE-CANARY', 'OCHRE-CANARY') if word in prompt)
            sample = re.findall(r'\[\d+\] tool\([^)]*\): ([^\n]+)', prompt)
            content = json.dumps({'experiences': [{'task': 'Negotiated position', 'solution': body or (sample[-1][:160] if sample else 'Synthetic decision filed.')}], 'ops':[{'action':'ADD','draft_idx':0}]})
            result = {'id': 'fixture', 'model': 'fixture', 'created': 0, 'object': 'chat.completion',
                      'choices': [{'index': 0, 'message': {'role':'assistant','content':content}, 'finish_reason':'stop'}],
                      'usage': {'prompt_tokens': 1, 'completion_tokens': 1, 'total_tokens': 2}}
        elif self.path == '/v1/embeddings':
            count = len(req['input']) if isinstance(req['input'], list) else 1
            vector = [1.0] + [0.0] * 7
            if req.get('encoding_format') == 'base64':
                import struct
                vector = base64.b64encode(struct.pack('<8f', *vector)).decode()
            result = {'object':'list','model':'fixture','data':[{'object':'embedding','index':i,'embedding':vector} for i in range(count)],
                      'usage': {'prompt_tokens': 1, 'total_tokens': 1}}
        else:
            self.send_error(404)
            return
        data = json.dumps(result).encode()
        self.send_response(200)
        self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(data)))
        self.end_headers()
        self.wfile.write(data)
