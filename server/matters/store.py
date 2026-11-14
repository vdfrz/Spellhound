"""Owner-only matter records. Only the authenticated server subject selects a vault."""
import hashlib
import re
import sqlite3
from contextlib import closing, contextmanager
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4


class Problem(Exception):
    def __init__(self, status, message):
        self.status = status
        super().__init__(message)


@dataclass(frozen=True)
class Principal:
    # The resolver supplies an issuer-qualified, immutable subject after authentication.
    subject: str


def text(value, limit):
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise Problem(400, f'Enter text between 1 and {limit:,} characters.')
    return value.strip()


@contextmanager
def database(path, schema):
    with closing(sqlite3.connect(path, timeout=10)) as db:
        db.row_factory = sqlite3.Row
        with db:
            db.execute(schema)
            yield db


CATALOG = 'CREATE TABLE IF NOT EXISTS matters (id TEXT PRIMARY KEY, name TEXT NOT NULL)'
RECORDS = '''CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
    created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))'''


class Matters:
    def __init__(self, root, principal, memory=None):
        if not isinstance(principal, Principal) or not isinstance(principal.subject, str) or not principal.subject.strip():
            raise Problem(401, 'A verified workspace identity is required.')
        self.vault = Path(root).resolve() / hashlib.sha256(principal.subject.encode()).hexdigest()
        self.vault.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.catalog = self.vault / 'catalog.sqlite'
        self.memory = memory

    def list(self):
        with database(self.catalog, CATALOG) as db:
            return [dict(r) for r in db.execute('SELECT id,name FROM matters ORDER BY rowid DESC')]

    def create(self, name):
        name, mid = text(name, 120), uuid4().hex
        with database(self.catalog, CATALOG) as db:
            directory = self.vault / mid
            directory.mkdir(mode=0o700)
            with database(directory / 'entries.sqlite', RECORDS):
                pass
            db.execute('INSERT INTO matters VALUES (?,?)', (mid, name))
        return {'id': mid, 'name': name}

    def authorized(self, mid):
        with database(self.catalog, CATALOG) as db:
            if not re.fullmatch(r'[a-f0-9]{32}', mid) or not db.execute('SELECT 1 FROM matters WHERE id=?', (mid,)).fetchone():
                raise Problem(404, 'Matter not found.')
        return self.vault / mid

    def entries(self, mid, kind=None):
        directory = self.authorized(mid)
        with database(directory / 'entries.sqlite', RECORDS) as db:
            query = 'SELECT * FROM entries' + (' WHERE kind=?' if kind else '') + ' ORDER BY rowid DESC'
            return [dict(r) for r in db.execute(query, (kind,) if kind else ())]

    def file(self, mid, kind, title, body):
        directory = self.authorized(mid)
        if kind not in ('reference', 'note', 'decision'):
            raise Problem(400, 'Choose a reference, note or decision.')
        title, body = text(title, 240), text(body, 120000 if kind == 'reference' else 12000)
        eid = uuid4().hex
        with database(directory / 'entries.sqlite', RECORDS) as db:
            db.execute('INSERT INTO entries (id,kind,title,body) VALUES (?,?,?,?)', (eid, kind, title, body))
            return dict(db.execute('SELECT * FROM entries WHERE id=?', (eid,)).fetchone())

    def experience(self, mid, decision_id=None):
        directory = self.authorized(mid)
        if not self.memory:
            raise Problem(503, 'Decision memory is unavailable. Your filed decisions are still here.')
        entry = None
        if decision_id is not None:
            with database(directory / 'entries.sqlite', RECORDS) as db:
                row = db.execute("SELECT title,body FROM entries WHERE id=? AND kind='decision'", (decision_id,)).fetchone()
                if row is None:
                    raise Problem(404, 'Decision not found.')
                entry = dict(row)
        # Storage, SDK user and workspace come only from server-owned identifiers.
        return self.memory(directory / 'memory', 'matter-' + mid, entry)
