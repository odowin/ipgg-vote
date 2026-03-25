'use strict';

const express  = require('express');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const geoip    = require('geoip-lite');
const { stmts }      = require('../db/database');
const { getSettings } = require('../lib/settings');
const { isValidToken, getTokenWindow, getCurrentToken, getTokenExpiresIn } = require('../lib/token');

const PASS_SECRET = process.env.JWT_SECRET || 'default_jwt_secret_change_me';

function getGeo(ip) {
  const clean = ip.replace(/^::ffff:/, '');
  const geo = geoip.lookup(clean);
  if (!geo) return { country: null, city: null };
  return { country: geo.country || null, city: geo.city || null };
}

// Parse a specific cookie from request headers
function getCookie(req, name) {
  const header = req.headers.cookie || '';
  const match  = header.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

const router = express.Router();

// GET /api/sessions/open  – list all open sessions (public)
router.get('/sessions/open', (req, res) => {
  const all = stmts.getAllSessions.all();
  const open = all.filter(s => s.status === 'open').map(s => ({
    id:          s.id,
    name:        s.name,
    type:        s.type,
    description: s.description,
  }));
  res.json(open);
});

// GET /api/session/:id  – public session info + candidates (only if open)
router.get('/session/:id', (req, res) => {
  const sessionId = parseInt(req.params.id, 10);
  if (!Number.isInteger(sessionId)) {
    return res.status(400).json({ error: 'Identifiant de session invalide.' });
  }

  const session = stmts.getSessionById.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session introuvable.' });
  }

  if (session.status !== 'open') {
    return res.status(403).json({ error: 'Cette session de vote est fermée.' });
  }

  const candidates = stmts.getCandidatesBySession.all(sessionId);

  res.json({
    session: {
      id:          session.id,
      name:        session.name,
      type:        session.type,
      description: session.description,
    },
    candidates: candidates.map(c => ({
      id:            c.id,
      name:          c.name,
      description:   c.description,
      image_url:     c.image_url,
      display_order: c.display_order,
    })),
  });
});

// POST /api/vote/pass  – exchange a fresh QR token for a vote pass
router.post('/vote/pass', (req, res) => {
  const settings  = getSettings();
  const { sessionId, token } = req.body || {};
  const ip        = req.ip || req.socket.remoteAddress || 'unknown';

  const sId = parseInt(sessionId, 10);
  if (!Number.isInteger(sId)) {
    return res.status(400).json({ error: 'Paramètres invalides.' });
  }

  // If QR is required, validate the token
  if (settings.qr_enabled) {
    if (!isValidToken(token, settings.qr_window_seconds, settings.qr_grace_windows)) {
      return res.status(400).json({
        error: 'QR code expiré ou invalide. Veuillez scanner le QR code affiché à l\'écran.',
      });
    }
  }

  const session = stmts.getSessionById.get(sId);
  if (!session) return res.status(404).json({ error: 'Session introuvable.' });
  if (session.status !== 'open') {
    return res.status(403).json({ error: 'Cette session de vote est fermée.' });
  }

  // Reuse existing voter_id cookie for this session, or generate a new one
  const cookieName = `ipgg_v_${sId}`;
  let voterId = getCookie(req, cookieName);
  if (!voterId) {
    voterId = crypto.randomBytes(16).toString('hex');
  }

  const tokenWindow = settings.qr_enabled ? getTokenWindow(token, settings.qr_window_seconds, settings.qr_grace_windows) : null;

  const pass = jwt.sign(
    { sessionId: sId, voterId, ip, tokenWindow },
    PASS_SECRET,
    { expiresIn: settings.pass_expires_minutes * 60 }
  );

  // Set voter cookie (persists across network changes, 4h)
  res.setHeader('Set-Cookie',
    `${cookieName}=${voterId}; Max-Age=14400; Path=/; SameSite=Strict`
  );

  res.json({ pass });
});

// POST /api/vote
router.post('/vote', (req, res) => {
  const settings  = getSettings();
  const { sessionId, candidateId, votePass } = req.body || {};
  const ip        = req.ip || req.socket.remoteAddress || 'unknown';
  const userAgent = req.headers['user-agent'] || '';

  // Validate vote pass
  let passPayload;
  try {
    passPayload = jwt.verify(votePass, PASS_SECRET);
  } catch (_) {
    return res.status(400).json({
      error: 'Session expirée (plus de ' + settings.pass_expires_minutes + ' min). Veuillez recharger la page.',
    });
  }

  const sId = parseInt(sessionId, 10);
  const cId = parseInt(candidateId, 10);
  if (!Number.isInteger(sId) || !Number.isInteger(cId)) {
    return res.status(400).json({ error: 'Paramètres invalides.' });
  }

  if (passPayload.sessionId !== sId) {
    return res.status(403).json({ error: 'Pass invalide pour cette session.' });
  }

  // Check session still open
  const session = stmts.getSessionById.get(sId);
  if (!session) return res.status(404).json({ error: 'Session introuvable.' });
  if (session.status !== 'open') {
    return res.status(403).json({ error: 'Cette session de vote est fermée.' });
  }

  // Check candidate belongs to this session
  const candidate = stmts.getCandidateById.get(cId);
  if (!candidate || candidate.session_id !== sId) {
    return res.status(404).json({ error: 'Candidat non trouvé.' });
  }

  const voterId = passPayload.voterId;

  // Check voter_id uniqueness (works across network changes)
  if (voterId) {
    const existing = stmts.getVoteByVoterId.get(sId, voterId);
    if (existing) {
      return res.status(409).json({ error: 'Vous avez déjà voté pour cette session.' });
    }
  }

  const { country, city } = getGeo(ip);

  try {
    // If ip_unique is disabled and same IP already voted, delete old vote first
    if (!settings.ip_unique) {
      stmts.deleteVoteByIp.run(sId, ip);
    }

    stmts.insertVote.run({
      session_id:   sId,
      candidate_id: cId,
      ip_address:   ip,
      token_window: passPayload.tokenWindow ?? null,
      user_agent:   userAgent,
      country,
      city,
      voter_id:     voterId || null,
    });
    res.json({ success: true, message: 'Vote enregistré !' });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || (err.message && err.message.includes('UNIQUE'))) {
      return res.status(409).json({ error: 'Vous avez déjà voté pour cette session.' });
    }
    console.error('Vote error:', err);
    res.status(500).json({ error: 'Erreur interne. Veuillez réessayer.' });
  }
});

// GET /api/token/status  – public, for UI countdown
router.get('/token/status', (req, res) => {
  const settings = getSettings();
  res.json({
    valid:        true,
    expiresIn:    getTokenExpiresIn(settings.qr_window_seconds),
    currentToken: getCurrentToken(settings.qr_window_seconds),
    windowSeconds: settings.qr_window_seconds,
  });
});

module.exports = router;
