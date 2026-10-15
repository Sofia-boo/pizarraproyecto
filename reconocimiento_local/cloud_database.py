"""Optional PostgreSQL storage. Local installations continue to use SQLite.

Only the small SQL dialect used by existing routes is adapted here. Schema
creation and data transfer are explicit operations, never a function cold start.
"""
import os
import re
import sqlite3
import json
import zlib
from contextlib import contextmanager
from datetime import datetime, timezone

_pool = None


def url():
    return os.environ.get('PIZARRA_DATABASE_URL') or (os.environ.get('DATABASE_URL') if os.environ.get('VERCEL') else None)


def enabled():
    return bool(url())


class Row(dict):
    def __getitem__(self, key):
        return tuple(self.values())[key] if isinstance(key, int) else super().__getitem__(key)


def row_factory(cursor):
    names = [column.name for column in cursor.description] if cursor.description else []
    return lambda values: Row(zip(names, values))


def pool():
    global _pool
    if _pool is None:
        from psycopg_pool import ConnectionPool
        _pool = ConnectionPool(url(), min_size=0, max_size=8, open=True,
                               timeout=15, kwargs={'row_factory': row_factory, 'connect_timeout': 15})
    return _pool


def placeholders(statement):
    # SQL values always remain parameters. A question mark inside a quoted
    # string is data, not a placeholder.
    result = []
    quote = None
    index = 0
    while index < len(statement):
        char = statement[index]
        if quote:
            result.append(char)
            if char == quote:
                if index + 1 < len(statement) and statement[index + 1] == quote:
                    result.append(quote)
                    index += 1
                else:
                    quote = None
        elif char in ("'", '"'):
            quote = char
            result.append(char)
        else:
            result.append('%s' if char == '?' else char)
        index += 1
    return ''.join(result)


class Connection:
    dialect = 'postgres'

    def __init__(self, connection):
        self.connection = connection

    def execute(self, statement, params=()):
        pragma = re.fullmatch(r'\s*PRAGMA table_info\((\w+)\)\s*', statement, re.I)
        if pragma:
            return self.connection.execute('''SELECT ordinal_position-1 AS cid, column_name AS name,
                data_type AS type FROM information_schema.columns
                WHERE table_schema=current_schema() AND table_name=%s ORDER BY ordinal_position''',
                (pragma[1],))
        if statement.strip().upper() == 'BEGIN IMMEDIATE':
            # Serialize share-code allocation/join operations across instances.
            return self.connection.execute('SELECT pg_advisory_xact_lock(73492181)')
        ignore = bool(re.match(r'\s*INSERT OR IGNORE\b', statement, re.I))
        if ignore:
            statement = re.sub(r'INSERT OR IGNORE', 'INSERT', statement, count=1, flags=re.I).rstrip().rstrip(';') + ' ON CONFLICT DO NOTHING'
        statement = re.sub(r'\browid\b', 'pizarra_seq', statement, flags=re.I)
        statement = re.sub(r'([\w.]+)\s+COLLATE NOCASE', r'lower(\1)', statement, flags=re.I)
        return self.connection.execute(placeholders(statement), params)

    def executescript(self, script):
        return self.connection.execute(script, prepare=False)

    def commit(self):
        self.connection.commit()

    def rollback(self):
        self.connection.rollback()

    def backup(self, destination):
        """Keep the pre-deletion administrator backup in durable storage too."""
        from psycopg import sql
        with pool().connection() as snapshot:
            snapshot.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
            schema = snapshot.execute("SELECT value FROM pizarra_meta WHERE key='sqlite_schema'").fetchone()
            if not schema:
                raise RuntimeError('Falta el esquema del respaldo migrado.')
            for table, definition in json.loads(schema['value']).items():
                destination.execute(definition)
                columns = [row[1] for row in destination.execute(f'PRAGMA table_info("{table}")')]
                query = sql.SQL('SELECT {} FROM {}').format(sql.SQL(',').join(map(sql.Identifier, columns)), sql.Identifier(table))
                rows = snapshot.execute(query).fetchall()
                if rows:
                    slots = ','.join('?' for _ in columns)
                    names = ','.join('"' + name + '"' for name in columns)
                    destination.executemany(f'INSERT INTO "{table}" ({names}) VALUES ({slots})',
                                            [tuple(row[name] for name in columns) for row in rows])
            for record in snapshot.execute("SELECT value FROM pizarra_meta WHERE key IN ('sqlite_indexes','sqlite_triggers')"):
                for definition in json.loads(record['value']):destination.execute(definition)
        destination.commit()
        serialized = destination.serialize()
        self.connection.execute('INSERT INTO pizarra_backups(created_at,data) VALUES (%s,%s)',
                                (datetime.now(timezone.utc).isoformat(), zlib.compress(serialized)))


@contextmanager
def connection():
    with pool().connection() as database:
        yield Connection(database)
