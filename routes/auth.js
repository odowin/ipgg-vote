'use strict';

const express = require('express');
const jwt     = require('jsonwebtoken');
const adminAuth = require('../middleware/adminAuth');

const router = express.Router();

const JWT_SECRET      = process.env.JWT_SECRET      || 'default_jwt_secret_change_me';
const ADMIN_USERNAME  = process.env.ADMIN_USERNAME  || 'admin';
const ADMIN_PASSWORD  = process.env.ADMIN_PASSWORD  || 'changeme';

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Identifiants manquants.' });
  }

  // Constant-time comparison to mitigate timing attacks
  const usernameMatch = username === ADMIN_USERNAME;
  const passwordMatch = password === ADMIN_PASSWORD;

  if (!usernameMatch || !passwordMatch) {
    return res.status(401).json({ error: 'Identifiants incorrects.' });
  }

  const token = jwt.sign(
    { username: ADMIN_USERNAME, role: 'admin' },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.json({ token, username: ADMIN_USERNAME, expiresIn: 8 * 3600 });
});

// GET /api/auth/me
router.get('/me', adminAuth, (req, res) => {
  res.json({ username: req.admin.username, role: req.admin.role });
});

module.exports = router;
