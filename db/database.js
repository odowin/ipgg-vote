'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Use /data volume if available (Railway persistent volume), otherwise local data/
const DB_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'votes.db');

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

// Performance and safety pragmas
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('cache_size = -16000'); // 16MB cache

// Schema setup
db.exec(`
  CREATE TABLE IF NOT EXISTS voting_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    type        TEXT    NOT NULL CHECK(type IN ('thesis', 'photo')),
    status      TEXT    NOT NULL DEFAULT 'closed' CHECK(status IN ('closed', 'open', 'finished')),
    description TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS candidates (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id    INTEGER NOT NULL REFERENCES voting_sessions(id) ON DELETE CASCADE,
    name          TEXT    NOT NULL,
    description   TEXT,
    image_url     TEXT,
    display_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS votes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   INTEGER NOT NULL REFERENCES voting_sessions(id) ON DELETE CASCADE,
    candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    ip_address   TEXT    NOT NULL,
    token_window INTEGER NOT NULL,
    user_agent   TEXT,
    voted_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(session_id, ip_address)
  );

  CREATE INDEX IF NOT EXISTS idx_votes_session    ON votes(session_id);
  CREATE INDEX IF NOT EXISTS idx_votes_candidate  ON votes(candidate_id);
  CREATE INDEX IF NOT EXISTS idx_candidates_session ON candidates(session_id);
`);

// Settings table
db.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Migrations
try { db.exec('ALTER TABLE voting_sessions ADD COLUMN display_key TEXT DEFAULT NULL'); } catch(_) {}
try { db.exec('ALTER TABLE votes ADD COLUMN country TEXT DEFAULT NULL'); } catch(_) {}
try { db.exec('ALTER TABLE votes ADD COLUMN city TEXT DEFAULT NULL'); } catch(_) {}
try { db.exec('ALTER TABLE votes ADD COLUMN voter_id TEXT DEFAULT NULL'); } catch(_) {}
try { db.exec('ALTER TABLE candidates ADD COLUMN jury_rank INTEGER DEFAULT NULL'); } catch(_) {}

// Prepared statements
const stmts = {
  // Sessions
  getAllSessions: db.prepare(
    'SELECT * FROM voting_sessions ORDER BY created_at DESC'
  ),
  getSessionById: db.prepare(
    'SELECT * FROM voting_sessions WHERE id = ?'
  ),
  createSession: db.prepare(
    'INSERT INTO voting_sessions (name, type, description) VALUES (@name, @type, @description)'
  ),
  updateSession: db.prepare(
    'UPDATE voting_sessions SET name = @name, type = @type, description = @description, status = @status WHERE id = @id'
  ),
  deleteSession: db.prepare(
    'DELETE FROM voting_sessions WHERE id = ?'
  ),

  // Candidates
  getCandidatesBySession: db.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM votes v WHERE v.candidate_id = c.id) AS vote_count
     FROM candidates c WHERE c.session_id = ? ORDER BY c.display_order, c.id`
  ),
  getCandidateById: db.prepare(
    'SELECT * FROM candidates WHERE id = ?'
  ),
  createCandidate: db.prepare(
    `INSERT INTO candidates (session_id, name, description, image_url, display_order)
     VALUES (@session_id, @name, @description, @image_url, @display_order)`
  ),
  updateCandidate: db.prepare(
    `UPDATE candidates SET name = @name, description = @description, image_url = @image_url,
     display_order = @display_order WHERE id = @id`
  ),
  deleteCandidate: db.prepare(
    'DELETE FROM candidates WHERE id = ?'
  ),

  // Votes
  insertVote: db.prepare(
    `INSERT INTO votes (session_id, candidate_id, ip_address, token_window, user_agent, country, city, voter_id)
     VALUES (@session_id, @candidate_id, @ip_address, @token_window, @user_agent, @country, @city, @voter_id)`
  ),
  getVotesBySession: db.prepare(
    `SELECT v.*, c.name AS candidate_name
     FROM votes v JOIN candidates c ON v.candidate_id = c.id
     WHERE v.session_id = ? ORDER BY v.voted_at DESC`
  ),
  getVoteById: db.prepare(
    'SELECT * FROM votes WHERE id = ?'
  ),
  deleteVote: db.prepare(
    'DELETE FROM votes WHERE id = ?'
  ),
  getVoteByVoterId: db.prepare(
    'SELECT id FROM votes WHERE session_id = ? AND voter_id = ?'
  ),
  deleteVoteByIp: db.prepare(
    'DELETE FROM votes WHERE session_id = ? AND ip_address = ?'
  ),
  getResultsBySession: db.prepare(
    `SELECT c.id, c.name, c.description, c.image_url, c.display_order, c.jury_rank,
            COUNT(v.id) AS vote_count
     FROM candidates c
     LEFT JOIN votes v ON v.candidate_id = c.id
     WHERE c.session_id = ?
     GROUP BY c.id
     ORDER BY vote_count DESC, c.display_order`
  ),
  getTotalVotesBySession: db.prepare(
    'SELECT COUNT(*) AS total FROM votes WHERE session_id = ?'
  ),

  // Display key
  setDisplayKey: db.prepare(
    'UPDATE voting_sessions SET display_key = @key WHERE id = @id'
  ),

  // Jury ranking
  setJuryRank: db.prepare('UPDATE candidates SET jury_rank = ? WHERE id = ?'),
  getJuryRanking: db.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM votes v WHERE v.candidate_id = c.id) AS vote_count
     FROM candidates c WHERE c.session_id = ? ORDER BY c.jury_rank ASC NULLS LAST, c.display_order`
  ),
};

module.exports = { db, stmts };
