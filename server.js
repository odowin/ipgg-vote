'use strict';

require('dotenv').config();

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const path       = require('path');

const { db } = require('./db/database');
const authRoutes    = require('./routes/auth');
const votesRoutes   = require('./routes/votes');
const adminRoutes   = require('./routes/admin');
const qrRoutes      = require('./routes/qr');
const displayRoutes = require('./routes/display');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Trust proxy (nginx) ──────────────────────────────────────────────────────
app.set('trust proxy', 1);

// ─── Security headers ─────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'"],
      styleSrc:    ["'self'", "'unsafe-inline'"],
      imgSrc:      ["'self'", 'data:', 'https:'],
      connectSrc:  ["'self'"],
      fontSrc:     ["'self'", 'data:'],
      objectSrc:       ["'none'"],
      scriptSrcAttr:   ["'unsafe-inline'"],
      upgradeInsecureRequests: [],
    },
  },
}));

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.BASE_URL || true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

// ─── Rate limiting ────────────────────────────────────────────────────────────
const voteLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 10,
  message: { error: 'Trop de tentatives. Veuillez patienter une minute.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => req.ip,
});

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  message: { error: 'Trop de requêtes. Veuillez patienter.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => req.ip,
});

app.use('/api/vote', voteLimiter);
app.use('/api/', generalLimiter);

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api',          votesRoutes);
app.use('/api/admin',    adminRoutes);
app.use('/api/qr',       qrRoutes);
app.use('/api/display',  displayRoutes);

// ─── Static files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  maxAge: 0,
}));

// ─── Vote page ────────────────────────────────────────────────────────────────
app.get('/vote', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'vote.html'));
});

// ─── Display page ─────────────────────────────────────────────────────────────
app.get('/display', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'display.html'));
});

// ─── Podium page ───────────────────────────────────────────────────────────────
app.get('/podium', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'podium.html'));
});

// ─── SPA fallback (not for API routes) ───────────────────────────────────────
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Global error handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Erreur interne du serveur.' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`IPGG Vote server running on port ${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin/`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
