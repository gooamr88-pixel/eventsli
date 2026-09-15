const express = require('express');
const { makeLimiter } = require('../middleware/rateLimit');
const { body, param } = require('express-validator');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const c = require('../controllers/authController');

const router = express.Router();

/**
 * A tight limiter on the credential endpoints specifically.
 *
 * The global /api limiter allows 1000 requests per 15 minutes, which is a
 * perfectly reasonable budget for a dashboard and an absurd one for password
 * guessing. Keyed by IP + email so one address cannot spray many accounts, and
 * many addresses cannot converge on one.
 */
const credentialLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => `${req.ip}|${String(req.body?.email || '').toLowerCase()}`,
  message: 'Too many attempts. Please wait a few minutes and try again.',
});

/**
 * Password rules: length over composition.
 *
 * A 12-character minimum with no character-class requirements follows current
 * NIST guidance. Forcing a symbol and a digit reliably produces `Password1!`,
 * which is both harder to remember and easier to guess than a longer passphrase.
 */
const passwordRules = (field = 'password') => body(field)
  .isString()
  .isLength({ min: 12, max: 200 })
  .withMessage('Use at least 12 characters — a short phrase works well.');

router.post(
  '/register',
  credentialLimiter,
  body('email').isEmail().normalizeEmail().withMessage('Enter a valid email address.'),
  passwordRules(),
  body('fullName').isString().trim().isLength({ min: 2, max: 120 })
    .withMessage('Enter your name.'),
  body('phone').optional({ values: 'falsy' }).isString().trim()
    .matches(/^[0-9+\-() ]{7,20}$/).withMessage('Enter a valid phone number.'),
  validate,
  c.register,
);

// ─── Email verification ────────────────────────────────────────────────────
/**
 * Twelve guesses per quarter hour per address and IP, on top of the five a
 * single code allows before it dies. Six digits is a small space; this is what
 * keeps it from being a searchable one.
 */
const verifyLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 12,
  name: 'verify-email',
  keyGenerator: (req) => `${req.ip}|${String(req.body?.email || '').toLowerCase()}`,
  message: 'Too many attempts. Wait a few minutes, then send yourself a new code.',
});

// Each resend is an email to an inbox. Six an hour is generous for a person
// and useless for someone trying to flood a stranger.
const resendLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000,
  max: 6,
  name: 'resend-verification',
  keyGenerator: (req) => `${req.ip}|${String(req.body?.email || '').toLowerCase()}`,
  message: 'Too many codes requested. Please wait before asking for another.',
});

router.post(
  '/verify-email',
  verifyLimiter,
  body('email').isEmail().normalizeEmail().withMessage('Enter a valid email address.'),
  body('code').isString().trim().matches(/^[\d\s-]{6,9}$/).withMessage('Enter the 6-digit code from the email.'),
  validate,
  c.verifyEmail,
);

router.post(
  '/resend-verification',
  resendLimiter,
  body('email').isEmail().normalizeEmail().withMessage('Enter a valid email address.'),
  validate,
  c.resendVerification,
);

router.post(
  '/login',
  credentialLimiter,
  body('email').isEmail().normalizeEmail().withMessage('Enter a valid email address.'),
  body('password').isString().notEmpty().withMessage('Enter your password.'),
  validate,
  c.login,
);

router.post('/logout', requireAuth, c.logout);
router.post('/logout-all', requireAuth, c.logoutAll);
router.get('/me', requireAuth, c.me);

router.get('/sessions', requireAuth, c.listSessions);
router.delete(
  '/sessions/:jti',
  requireAuth,
  param('jti').isUUID().withMessage('Not a valid session id.'),
  validate,
  c.endSession,
);

router.post(
  '/change-password',
  requireAuth,
  credentialLimiter,
  body('currentPassword').isString().notEmpty().withMessage('Enter your current password.'),
  passwordRules('newPassword'),
  validate,
  c.changePassword,
);

router.post(
  '/google',
  credentialLimiter,
  body('idToken').isString().isLength({ min: 50, max: 4000 })
    .withMessage('Google sign-in did not return a token.'),
  validate,
  c.googleSignIn,
);

// ─── Password reset ────────────────────────────────────────────────────────
/**
 * Tighter than the credential limiter, and keyed by IP ALONE.
 *
 * Keying by email as well would let someone spray a thousand addresses from one
 * machine — each getting its own budget — which is both an enumeration probe
 * and a way to have us mail a thousand strangers on their behalf.
 */
const resetLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000,
  max: 8,
  message: 'Too many reset requests. Please wait an hour and try again.',
});

router.post(
  '/forgot-password',
  resetLimiter,
  body('email').isEmail().normalizeEmail().withMessage('Enter a valid email address.'),
  validate,
  c.forgotPassword,
);

router.post(
  '/reset-password',
  resetLimiter,
  body('token').isString().isLength({ min: 20, max: 200 })
    .withMessage('That reset link is not valid.'),
  passwordRules(),
  validate,
  c.resetPassword,
);

module.exports = router;
