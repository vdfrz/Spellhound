"""One private, synchronous Hy-Memory operation; only the adapter starts this worker."""
import fcntl
import json
import os
import sys


def main():
    os.umask(0o077)
    data = json.load(sys.stdin)
    identity, entry = data['identity'], data['entry']
    # SDK logs can include source text. Keep them off the response channel.
    output = os.fdopen(os.dup(1), 'w')
    os.dup2(2, 1)
    with open('worker.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        from hy_memory import HyMemoryClient
        client = HyMemoryClient(mode='pro')
        try:
            scope = dict(user_id=identity, workspace_id=identity, scene='working')
            if entry is not None:
                # Record the actual read from the matter's filed decisions. The working
                # writer in 2.0.16 requires a tool turn; plain text routes to chat.
                messages = [{'role': 'user', 'content': 'Summarize the filed decision: ' + entry['title']},
                            {'role': 'assistant', 'content': '', 'tool_calls': [{'id':'read', 'type':'function',
                             'function': {'name':'read_filed_decision','arguments':'{}'}}]},
                            {'role': 'tool', 'tool_call_id':'read', 'name':'read_filed_decision','content':entry['body']}]
                receipt = client.add(messages,
                                     session_id=identity, source='spellhound', language='en', **scope)
                if not receipt.get('success') or receipt.get('variant') != 'working':
                    raise RuntimeError('SDK write failed')
            result = client.list_memories(include_sources=['spellhound'], limit=50, **scope)
            rows = [{'id': r['experience_id'], 'title': r['task'], 'body': r['solution']}
                    for r in result['experiences'] if r['workspace_id'] == identity]
            json.dump(rows, output)
        finally:
            client.close()
            output.close()


if __name__ == '__main__':
    main()
