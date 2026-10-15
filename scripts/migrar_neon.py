"""Copy SQLite into a NEW, EMPTY PostgreSQL database. Never removes source data.

Usage: PIZARRA_DATABASE_URL in the environment; python scripts/migrar_neon.py
       --source datos/pizarras.db --apply
Without --apply, only aggregate readiness information is displayed.
"""
import argparse
import json
import os
import re
import sqlite3
from pathlib import Path
from datetime import datetime, timezone
from contextlib import closing


def migrate(source, url):
    import psycopg
    from psycopg import sql
    with closing(sqlite3.connect(source.as_uri()+'?mode=ro',uri=True)) as original:
        backup=source.parent/'backups'/('antes-neon-'+datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')+'.db')
        backup.parent.mkdir(parents=True,exist_ok=True)
        with closing(sqlite3.connect(backup)) as saved:
            original.backup(saved)
    with closing(sqlite3.connect(backup)) as local, psycopg.connect(url) as cloud:
        cloud.execute('SELECT pg_advisory_xact_lock(73492182)')
        existing=cloud.execute("SELECT tablename FROM pg_tables WHERE schemaname=current_schema()").fetchall()
        if existing:
            raise RuntimeError('El destino debe estar vacio. No se reemplazaron datos existentes.')
        schema=dict(local.execute("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"))
        ordered=[]
        pending=set(schema)
        while pending:
            ready=sorted(table for table in pending if all(row[2] not in pending or row[2]==table
                         for row in local.execute(f'PRAGMA foreign_key_list("{table}")')))
            if not ready:raise RuntimeError('Hay referencias circulares en el esquema.')
            for table in ready:
                definition=re.sub(r'\bBLOB\b','BYTEA',schema[table],flags=re.I)
                cloud.execute(definition)
                if table in ('calendars','board_history'):
                    cloud.execute(sql.SQL('ALTER TABLE {} ADD COLUMN pizarra_seq BIGSERIAL').format(sql.Identifier(table)))
                ordered.append(table);pending.remove(table)
        counts={}
        for table in ordered:
            columns=[row[1] for row in local.execute(f'PRAGMA table_info("{table}")')]
            rows=local.execute(f'SELECT * FROM "{table}" ORDER BY rowid').fetchall()
            if rows:
                statement=sql.SQL('INSERT INTO {} ({}) VALUES ({})').format(sql.Identifier(table),
                    sql.SQL(',').join(map(sql.Identifier,columns)),sql.SQL(',').join(sql.Placeholder() for _ in columns))
                with cloud.cursor() as cursor:cursor.executemany(statement,rows)
            counts[table]=len(rows)
        indexes=[row[0] for row in local.execute("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL")]
        triggers=[row[0] for row in local.execute("SELECT sql FROM sqlite_master WHERE type='trigger' AND sql IS NOT NULL")]
        for definition in indexes:
            cloud.execute(definition)
        cloud.execute((Path(__file__).resolve().parents[1]/'reconocimiento_local/cloud_schema.sql').read_text(encoding='utf-8'),prepare=False)
        cloud.execute("INSERT INTO pizarra_meta(key,value) VALUES ('sqlite_schema',%s),('schema_version','1')",(json.dumps(schema),))
        cloud.execute("INSERT INTO pizarra_meta(key,value) VALUES ('sqlite_indexes',%s),('sqlite_triggers',%s)",
                      (json.dumps(indexes),json.dumps(triggers)))
        for table,expected in counts.items():
            columns=[row[1] for row in local.execute(f'PRAGMA table_info("{table}")')]
            actual=cloud.execute(sql.SQL('SELECT {} FROM {}').format(sql.SQL(',').join(map(sql.Identifier,columns)),sql.Identifier(table))).fetchall()
            original=local.execute(f'SELECT * FROM "{table}"').fetchall()
            # Compare every value (including files and password hashes), not just
            # row counts. No user content or credential appears in the output.
            if len(actual)!=expected or set(actual)!=set(original):
                raise RuntimeError('La verificacion completa fallo; se revierte la transaccion.')
        print(json.dumps({'migrated':True,'counts':counts,'all_values_verified':True,'source_preserved':True}))


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--source',default='datos/pizarras.db')
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args()
    source=Path(args.source).resolve()
    if not args.apply:
        with sqlite3.connect(source.as_uri()+'?mode=ro',uri=True) as db:
            print(json.dumps({'source_bytes':source.stat().st_size,'boards':db.execute('SELECT COUNT(*) FROM boards').fetchone()[0],
                'assets_bytes':db.execute('SELECT COALESCE(SUM(length(data)),0) FROM assets').fetchone()[0],'migration_started':False}))
    else:
        url=os.environ.get('PIZARRA_DATABASE_URL')
        if not url:raise SystemExit('Configura PIZARRA_DATABASE_URL de forma privada, no como argumento de consola.')
        migrate(source,url)
