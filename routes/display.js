'use strict';
const express = require('express');
const QRCode  = require('qrcode');
const { stmts }       = require('../db/database');
const { getSettings }  = require('../lib/settings');
const { getCurrentToken, getTokenExpiresIn } = require('../lib/token');
const router = express.Router();
const BASE_URL = () => process.env.BASE_URL || 'http://localhost:3000';

// GET /api/display/qr?s=<id>&k=<key>
router.get('/qr', async (req, res) => {
  const id  = parseInt(req.query.s, 10);
  const key = req.query.k;
  if (!id || !key) return res.status(400).json({ error: 'Paramètres manquants.' });

  const session = stmts.getSessionById.get(id);
  if (!session || session.display_key !== key) return res.status(403).json({ error: 'Accès refusé.' });

  const settings  = getSettings();
  const token     = getCurrentToken(settings.qr_window_seconds);
  const expiresIn = getTokenExpiresIn(settings.qr_window_seconds);
  const url       = settings.qr_enabled
    ? `${BASE_URL()}/vote?s=${id}&t=${token}`
    : `${BASE_URL()}/vote?s=${id}`;

  try {
    const dataUrl = await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M', type: 'image/png', width: 600, margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    });
    res.json({
      dataUrl,
      expiresIn,
      windowSeconds: settings.qr_window_seconds,
      sessionName:   session.name,
      sessionStatus: session.status,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur génération QR.' });
  }
});

// GET /api/display/results?s=<id>&k=<key>  – public results via display key
router.get('/results', (req, res) => {
  const id  = parseInt(req.query.s, 10);
  const key = req.query.k;
  if (!id || !key) return res.status(400).json({ error: 'Paramètres manquants.' });

  const session = stmts.getSessionById.get(id);
  if (!session || session.display_key !== key) return res.status(403).json({ error: 'Accès refusé.' });

  const results  = stmts.getResultsBySession.all(id);
  const totalRow = stmts.getTotalVotesBySession.get(id);
  const total    = totalRow ? totalRow.total : 0;

  res.json({
    session: { id: session.id, name: session.name, type: session.type, status: session.status },
    candidates: results.map(r => ({
      ...r,
      percentage: total > 0 ? Math.round((r.vote_count / total) * 100) : 0,
    })),
    total_votes: total,
  });
});

module.exports = router;
