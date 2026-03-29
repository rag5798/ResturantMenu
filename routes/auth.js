const router = require('express').Router();
const crypto = require('crypto');
const passport = require('passport');

// Start Google OAuth flow
router.get(
  '/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

// Google OAuth callback
router.get(
  '/google/callback',
  passport.authenticate('google', { failureRedirect: '/admin?error=unauthorized' }),
  (req, res) => {
    res.redirect('/admin');
  }
);

// Logout
router.get('/logout', (req, res) => {
  req.logout(() => {
    res.redirect('/');
  });
});

// Check auth status (for frontend) — also returns CSRF token
router.get('/status', (req, res) => {
  if (req.isAuthenticated()) {
    // Generate CSRF token and store in session
    if (!req.session.csrfToken) {
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    }
    res.json({ authenticated: true, user: req.user, csrfToken: req.session.csrfToken });
  } else {
    res.json({ authenticated: false });
  }
});

module.exports = router;
