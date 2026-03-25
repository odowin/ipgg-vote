'use strict';

const { db } = require('../db/database');

const DEFAULTS = {
  qr_enabled:           'true',   // require QR scan to get a vote pass
  qr_window_seconds:    '30',     // how often the QR token rotates
  qr_grace_windows:     '2',      // tolerance: accept N previous windows
  pass_expires_minutes: '90',     // how long the vote pass is valid
  ip_unique:            'true',   // one vote per IP per session
};

// Seed defaults (INSERT OR IGNORE — never overwrite existing values)
const seedStmt = db.prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(DEFAULTS)) {
  seedStmt.run(key, value);
}

const getAll  = db.prepare('SELECT key, value FROM app_settings');
const setStmt = db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)');

function getSettings() {
  const rows = getAll.all();
  const raw  = {};
  for (const r of rows) raw[r.key] = r.value;
  return {
    qr_enabled:           raw.qr_enabled           !== 'false',
    qr_window_seconds:    Math.max(1,  parseInt(raw.qr_window_seconds,    10) || 30),
    qr_grace_windows:     Math.max(1,  parseInt(raw.qr_grace_windows,     10) || 2),
    pass_expires_minutes: Math.max(1,  parseInt(raw.pass_expires_minutes, 10) || 90),
    ip_unique:            raw.ip_unique             !== 'false',
  };
}

function setSetting(key, value) {
  if (!(key in DEFAULTS)) throw new Error(`Unknown setting: ${key}`);
  setStmt.run(key, String(value));
}

module.exports = { getSettings, setSetting, DEFAULTS };
