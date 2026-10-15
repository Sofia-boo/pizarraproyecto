-- Extra shared state for horizontally scaled Vercel functions.
CREATE TABLE IF NOT EXISTS pizarra_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pizarra_backups (id BIGSERIAL PRIMARY KEY, created_at TEXT NOT NULL, data BYTEA NOT NULL);
CREATE TABLE IF NOT EXISTS pizarra_live_events (id BIGSERIAL PRIMARY KEY, board_id TEXT NOT NULL, payload TEXT NOT NULL, created_at DOUBLE PRECISION NOT NULL);
CREATE INDEX IF NOT EXISTS ix_live_events_time ON pizarra_live_events(created_at);
CREATE TABLE IF NOT EXISTS pizarra_live_peers (client_id TEXT PRIMARY KEY, board_id TEXT NOT NULL, node_id TEXT NOT NULL, profile TEXT NOT NULL, view TEXT, changed DOUBLE PRECISION NOT NULL DEFAULT 0, seen DOUBLE PRECISION NOT NULL);
CREATE INDEX IF NOT EXISTS ix_live_peers_board ON pizarra_live_peers(board_id,seen);
CREATE TABLE IF NOT EXISTS pizarra_live_tickets (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, board_id TEXT NOT NULL, expires DOUBLE PRECISION NOT NULL);
CREATE TABLE IF NOT EXISTS pizarra_live_ink (board_id TEXT NOT NULL, stroke_id TEXT NOT NULL, version INTEGER NOT NULL, removed BOOLEAN NOT NULL, updated DOUBLE PRECISION NOT NULL, PRIMARY KEY(board_id,stroke_id));
CREATE TABLE IF NOT EXISTS pizarra_live_state (board_id TEXT NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(board_id,kind));
CREATE TABLE IF NOT EXISTS pizarra_rate (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires DOUBLE PRECISION NOT NULL);
CREATE TABLE IF NOT EXISTS pizarra_asset_uploads (asset_id TEXT NOT NULL, user_id TEXT NOT NULL, upload_id TEXT NOT NULL,
 mime TEXT NOT NULL, total INTEGER NOT NULL, next_offset INTEGER NOT NULL, data BYTEA NOT NULL,
 updated DOUBLE PRECISION NOT NULL, PRIMARY KEY(asset_id,user_id,upload_id));

CREATE OR REPLACE FUNCTION pizarra_event_owner() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.owner_user_id := (SELECT owner_user_id FROM calendars WHERE id=NEW.calendar_id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS pizarra_event_owner ON calendar_events;
CREATE TRIGGER pizarra_event_owner BEFORE INSERT OR UPDATE OF calendar_id ON calendar_events
FOR EACH ROW EXECUTE FUNCTION pizarra_event_owner();

CREATE OR REPLACE FUNCTION pizarra_history() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.content::jsonb - 'camera') IS DISTINCT FROM (OLD.content::jsonb - 'camera')
    AND NOT EXISTS (SELECT 1 FROM board_history WHERE board_id=NEW.id AND kind='auto'
      AND created_at::timestamptz > clock_timestamp()-interval '300 minutes') THEN
    INSERT INTO board_history(id,board_id,board_version,kind,title,content,size_bytes,created_at)
      VALUES(md5(random()::text||clock_timestamp()::text),NEW.id,NEW.version,'auto','',NEW.content,
        octet_length(NEW.content),to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    DELETE FROM board_history WHERE id IN (SELECT id FROM board_history WHERE board_id=NEW.id AND kind='auto'
      ORDER BY created_at DESC,pizarra_seq DESC OFFSET 40);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS pizarra_history ON boards;
CREATE TRIGGER pizarra_history AFTER UPDATE OF content ON boards FOR EACH ROW EXECUTE FUNCTION pizarra_history();
