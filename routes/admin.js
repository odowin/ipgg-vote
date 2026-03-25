'use strict';

const express   = require('express');
const QRCode    = require('qrcode');
const multer    = require('multer');
const path      = require('path');
const fs        = require('fs');
const adminAuth = require('../middleware/adminAuth');
const { db, stmts } = require('../db/database');
const { getSettings, setSetting, DEFAULTS } = require('../lib/settings');
const { getCurrentToken, getTokenExpiresIn } = require('../lib/token');

const router = express.Router();

// All admin routes require authentication
router.use(adminAuth);

const BASE_URL = () => process.env.BASE_URL || 'http://localhost:3000';

// ─── File upload ──────────────────────────────────────────────────────────────

const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Fichier image requis.'));
  },
});

// POST /api/admin/upload
router.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// ─── Sessions ────────────────────────────────────────────────────────────────

// GET /api/admin/sessions
router.get('/sessions', (req, res) => {
  const sessions = stmts.getAllSessions.all();
  // Attach vote counts
  const result = sessions.map(s => {
    const row = stmts.getTotalVotesBySession.get(s.id);
    return { ...s, total_votes: row ? row.total : 0 };
  });
  res.json(result);
});

// POST /api/admin/sessions
router.post('/sessions', (req, res) => {
  const { name, type, description } = req.body || {};
  if (!name || !type) {
    return res.status(400).json({ error: 'Le nom et le type sont requis.' });
  }
  if (!['thesis', 'photo'].includes(type)) {
    return res.status(400).json({ error: 'Type invalide. Valeurs acceptées: thesis, photo.' });
  }
  const info = stmts.createSession.run({ name, type, description: description || null });
  const session = stmts.getSessionById.get(info.lastInsertRowid);
  res.status(201).json(session);
});

// PUT /api/admin/sessions/:id
router.put('/sessions/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const session = stmts.getSessionById.get(id);
  if (!session) return res.status(404).json({ error: 'Session introuvable.' });

  const { name, type, description, status } = req.body || {};
  const updated = {
    id,
    name:        name        ?? session.name,
    type:        type        ?? session.type,
    description: description ?? session.description,
    status:      status      ?? session.status,
  };

  if (!['thesis', 'photo'].includes(updated.type)) {
    return res.status(400).json({ error: 'Type invalide.' });
  }
  if (!['closed', 'open', 'finished'].includes(updated.status)) {
    return res.status(400).json({ error: 'Statut invalide.' });
  }

  stmts.updateSession.run(updated);
  res.json(stmts.getSessionById.get(id));
});

// DELETE /api/admin/sessions/:id
router.delete('/sessions/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const session = stmts.getSessionById.get(id);
  if (!session) return res.status(404).json({ error: 'Session introuvable.' });
  stmts.deleteSession.run(id);
  res.json({ success: true });
});

// ─── Candidates ──────────────────────────────────────────────────────────────

// GET /api/admin/sessions/:id/candidates
router.get('/sessions/:id/candidates', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!stmts.getSessionById.get(id)) {
    return res.status(404).json({ error: 'Session introuvable.' });
  }
  res.json(stmts.getCandidatesBySession.all(id));
});

// POST /api/admin/sessions/:id/candidates
router.post('/sessions/:id/candidates', (req, res) => {
  const session_id = parseInt(req.params.id, 10);
  if (!stmts.getSessionById.get(session_id)) {
    return res.status(404).json({ error: 'Session introuvable.' });
  }

  const { name, description, image_url, display_order } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Le nom est requis.' });

  const info = stmts.createCandidate.run({
    session_id,
    name,
    description: description || null,
    image_url:   image_url   || null,
    display_order: parseInt(display_order, 10) || 0,
  });
  res.status(201).json(stmts.getCandidateById.get(info.lastInsertRowid));
});

// PUT /api/admin/candidates/:id
router.put('/candidates/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const candidate = stmts.getCandidateById.get(id);
  if (!candidate) return res.status(404).json({ error: 'Candidat introuvable.' });

  const { name, description, image_url, display_order } = req.body || {};
  stmts.updateCandidate.run({
    id,
    name:          name          ?? candidate.name,
    description:   description   ?? candidate.description,
    image_url:     image_url     ?? candidate.image_url,
    display_order: display_order !== undefined ? parseInt(display_order, 10) : candidate.display_order,
  });
  res.json(stmts.getCandidateById.get(id));
});

// DELETE /api/admin/candidates/:id
router.delete('/candidates/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!stmts.getCandidateById.get(id)) {
    return res.status(404).json({ error: 'Candidat introuvable.' });
  }
  stmts.deleteCandidate.run(id);
  res.json({ success: true });
});

// ─── Results ─────────────────────────────────────────────────────────────────

// GET /api/admin/sessions/:id/results
router.get('/sessions/:id/results', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const session = stmts.getSessionById.get(id);
  if (!session) return res.status(404).json({ error: 'Session introuvable.' });

  const results = stmts.getResultsBySession.all(id);
  const totalRow = stmts.getTotalVotesBySession.get(id);
  const total = totalRow ? totalRow.total : 0;

  const enriched = results.map(r => ({
    ...r,
    percentage: total > 0 ? Math.round((r.vote_count / total) * 100) : 0,
  }));

  res.json({ session, candidates: enriched, total_votes: total });
});

// GET /api/admin/sessions/:id/votes  (audit trail)
router.get('/sessions/:id/votes', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!stmts.getSessionById.get(id)) {
    return res.status(404).json({ error: 'Session introuvable.' });
  }
  res.json(stmts.getVotesBySession.all(id));
});

// DELETE /api/admin/votes/:id
router.delete('/votes/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!stmts.getVoteById.get(id)) {
    return res.status(404).json({ error: 'Vote introuvable.' });
  }
  stmts.deleteVote.run(id);
  res.json({ success: true });
});

// ─── CSV Export ──────────────────────────────────────────────────────────────

// GET /api/admin/sessions/:id/results/csv
router.get('/sessions/:id/results/csv', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const session = stmts.getSessionById.get(id);
  if (!session) return res.status(404).json({ error: 'Session introuvable.' });

  const results  = stmts.getResultsBySession.all(id);
  const totalRow = stmts.getTotalVotesBySession.get(id);
  const total    = totalRow ? totalRow.total : 0;

  const csvRows = [
    ['Candidat', 'Votes', 'Pourcentage'],
    ...results.map(r => [
      `"${r.name.replace(/"/g, '""')}"`,
      r.vote_count,
      total > 0 ? `${Math.round((r.vote_count / total) * 100)}%` : '0%',
    ]),
    [],
    ['Total', total, '100%'],
  ];

  const csv = csvRows.map(row => row.join(',')).join('\r\n');
  const filename = `resultats_${session.name.replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\uFEFF' + csv); // BOM for Excel UTF-8 compatibility
});

// ─── Anti-cheat Settings ─────────────────────────────────────────────────────

// GET /api/admin/settings
router.get('/settings', (req, res) => {
  res.json(getSettings());
});

// PUT /api/admin/settings
router.put('/settings', (req, res) => {
  const allowed = Object.keys(DEFAULTS);
  const body    = req.body || {};
  const errors  = [];

  for (const key of allowed) {
    if (!(key in body)) continue;
    try {
      setSetting(key, body[key]);
    } catch (e) {
      errors.push(e.message);
    }
  }

  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  res.json(getSettings());
});

// ─── Display Key ─────────────────────────────────────────────────────────────

// POST /api/admin/sessions/:id/display-key  – generate or reset display key
router.post('/sessions/:id/display-key', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const session = stmts.getSessionById.get(id);
  if (!session) return res.status(404).json({ error: 'Session introuvable.' });
  const key = require('crypto').randomBytes(16).toString('hex');
  stmts.setDisplayKey.run({ key, id });
  res.json({ key, url: `${BASE_URL()}/display?s=${id}&k=${key}` });
});

// ─── QR Code ─────────────────────────────────────────────────────────────────

// GET /api/admin/qr/:sessionId  – returns PNG data URL
router.get('/qr/:sessionId', async (req, res) => {
  const id = parseInt(req.params.sessionId, 10);
  if (!stmts.getSessionById.get(id)) {
    return res.status(404).json({ error: 'Session introuvable.' });
  }

  const settings = getSettings();
  const token    = getCurrentToken(settings.qr_window_seconds);
  const expiresIn = getTokenExpiresIn(settings.qr_window_seconds);
  const url      = settings.qr_enabled
    ? `${BASE_URL()}/vote?s=${id}&t=${token}`
    : `${BASE_URL()}/vote?s=${id}`;

  try {
    const dataUrl = await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      type:   'image/png',
      width:  400,
      margin: 2,
      color:  { dark: '#000000', light: '#ffffff' },
    });
    res.json({ dataUrl, token, expiresIn, windowSeconds: settings.qr_window_seconds, url });
  } catch (err) {
    console.error('QR generation error:', err);
    res.status(500).json({ error: 'Erreur de génération du QR code.' });
  }
});

// PUT /api/admin/sessions/:id/jury-ranks  – set jury ranks for all candidates at once
router.put('/sessions/:id/jury-ranks', (req, res) => {
  const sessionId = parseInt(req.params.id, 10);
  if (!stmts.getSessionById.get(sessionId)) return res.status(404).json({ error: 'Session introuvable.' });

  const { ranks } = req.body || {}; // { candidateId: rank, ... }
  if (!ranks || typeof ranks !== 'object') return res.status(400).json({ error: 'Paramètre ranks requis.' });

  const update = db.transaction(() => {
    for (const [candidateId, rank] of Object.entries(ranks)) {
      const cId = parseInt(candidateId, 10);
      const r   = rank === null || rank === '' ? null : parseInt(rank, 10);
      stmts.setJuryRank.run(r || null, cId);
    }
  });
  update();

  res.json(stmts.getCandidatesBySession.all(sessionId));
});

module.exports = router;
