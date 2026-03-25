'use strict';

const express = require('express');
const QRCode  = require('qrcode');
const { stmts }      = require('../db/database');
const { getSettings } = require('../lib/settings');
const { getCurrentToken, getTokenExpiresIn } = require('../lib/token');

const router  = express.Router();
const BASE_URL = () => process.env.BASE_URL || 'http://localhost:3000';

// GET /api/qr/:sessionId  – public, for projector display
router.get('/:sessionId', async (req, res) => {
  const id = parseInt(req.params.sessionId, 10);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Identifiant invalide.' });
  }

  const session = stmts.getSessionById.get(id);
  if (!session) {
    return res.status(404).json({ error: 'Session introuvable.' });
  }
  if (session.status !== 'open') {
    return res.status(403).json({ error: 'Cette session est fermée.' });
  }

  const settings  = getSettings();
  const token     = getCurrentToken(settings.qr_window_seconds);
  const expiresIn = getTokenExpiresIn(settings.qr_window_seconds);
  const url       = settings.qr_enabled
    ? `${BASE_URL()}/vote?s=${id}&t=${token}`
    : `${BASE_URL()}/vote?s=${id}`;

  try {
    const svg = await QRCode.toString(url, {
      type:                 'svg',
      errorCorrectionLevel: 'M',
      width:                300,
      margin:               2,
      color:                { dark: '#000000', light: '#ffffff' },
    });

    res.json({ svg, token, expiresIn, url, sessionName: session.name });
  } catch (err) {
    console.error('QR SVG error:', err);
    res.status(500).json({ error: 'Erreur de génération du QR code.' });
  }
});

module.exports = router;
