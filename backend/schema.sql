-- Atlas Organizer 2.1: somente credenciais e sessoes; o acervo/agenda ficam no Google Drive.
CREATE TABLE IF NOT EXISTS accounts (
 sub TEXT PRIMARY KEY,
 email TEXT NOT NULL,
 refresh_enc TEXT NOT NULL,
 access_enc TEXT,
 access_expires INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 session_hash TEXT PRIMARY KEY,
 sub TEXT NOT NULL REFERENCES accounts(sub),
 expires_at INTEGER NOT NULL,
 last_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_atlas_sessions_sub ON sessions(sub);
CREATE INDEX IF NOT EXISTS idx_atlas_sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS oauth_states (
 state TEXT PRIMARY KEY,
 verifier TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_atlas_states_expiry ON oauth_states(expires_at);
