'use strict';

const crypto = require('crypto');

const QR_SECRET = process.env.QR_SECRET || 'default_secret_change_me';

// Env defaults (used as fallback when settings DB isn't available)
const DEFAULT_WINDOW_SECONDS = parseInt(process.env.TOKEN_WINDOW_SECONDS || '30', 10);
const DEFAULT_GRACE_WINDOWS  = parseInt(process.env.TOKEN_GRACE_WINDOWS  || '2',  10);

function generateToken(windowIndex) {
  return crypto
    .createHmac('sha256', QR_SECRET)
    .update(String(windowIndex))
    .digest('hex')
    .slice(0, 16);
}

function getCurrentToken(windowSeconds = DEFAULT_WINDOW_SECONDS) {
  const w = Math.floor(Date.now() / (windowSeconds * 1000));
  return generateToken(w);
}

function isValidToken(token, windowSeconds = DEFAULT_WINDOW_SECONDS, graceWindows = DEFAULT_GRACE_WINDOWS) {
  if (!token || typeof token !== 'string') return false;
  const current = Math.floor(Date.now() / (windowSeconds * 1000));
  for (let i = 0; i < graceWindows; i++) {
    if (generateToken(current - i) === token) return true;
  }
  return false;
}

function getTokenWindow(token, windowSeconds = DEFAULT_WINDOW_SECONDS, graceWindows = DEFAULT_GRACE_WINDOWS) {
  if (!token || typeof token !== 'string') return null;
  const current = Math.floor(Date.now() / (windowSeconds * 1000));
  for (let i = 0; i < graceWindows; i++) {
    const w = current - i;
    if (generateToken(w) === token) return w;
  }
  return null;
}

function getTokenExpiresIn(windowSeconds = DEFAULT_WINDOW_SECONDS) {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  return windowMs - (now % windowMs);
}

module.exports = {
  generateToken,
  getCurrentToken,
  isValidToken,
  getTokenWindow,
  getTokenExpiresIn,
  DEFAULT_WINDOW_SECONDS,
  DEFAULT_GRACE_WINDOWS,
};
