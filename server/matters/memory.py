"""Give each SDK call a clean process and a matter-only home, cwd and data root."""
import json
import os
import subprocess
import sys
from pathlib import Path
from .store import Problem


def hy_memory(*, base_url, chat_model, embedding_model, dimensions, api_key):
    # Model configuration is injected by trusted server code; never use it as a subject.
    def run(directory, identity, entry):
        directory.mkdir(mode=0o700, exist_ok=True)
        env = {'PATH': os.defpath, 'HOME': str(directory), 'MEMORY_DATA_DIR': str(directory),
               'ANONYMIZED_TELEMETRY': 'False', 'MEMORY_LLM_MODEL': chat_model,
               'MEMORY_EMBEDDER_MODEL': embedding_model, 'MEMORY_EMBEDDING_DIMS': str(dimensions),
               'MEMORY_LLM_BASE_URL': base_url, 'MEMORY_EMBEDDER_BASE_URL': base_url,
               'MEMORY_LLM_API_KEY': api_key, 'MEMORY_EMBEDDER_API_KEY': api_key,
               'MEMORY_LLM_MAX_RETRIES': '1', 'MEMORY_EMBEDDER_MAX_RETRIES': '0'}
        try:
            proc = subprocess.run([sys.executable, '-I', str(Path(__file__).with_name('worker.py').resolve())],
                                  input=json.dumps({'identity': identity, 'entry': entry}),
                                  env=env, cwd=directory, text=True, stdout=subprocess.PIPE,
                                  stderr=subprocess.DEVNULL, timeout=90, check=True)
            return json.loads(proc.stdout)
        except (subprocess.SubprocessError, OSError, ValueError):
            raise Problem(503, 'Memory did not finish. Reopen the saved decision or try again.') from None
    return run
