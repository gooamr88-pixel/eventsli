const express = require('express');
const { sendOk } = require('../utils/responseEnvelope');

const router = express.Router();

/**
 * GET /app/config — what the native check-in app reads before anything else.
 *
 * `minSupportedVersion` is the lever for a fix the door cannot run without: a
 * build older than it shows "Update required" instead of scanning. Raised only
 * for a change the API can no longer serve the old way — never routinely,
 * because it stops every door that has not updated.
 *
 * Public and static: no account, nothing per-user, safe to cache briefly.
 */
const semver = (v, fallback) => (/^\d+\.\d+\.\d+$/.test(String(v || '')) ? String(v) : fallback);

router.get('/config', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  return sendOk(res, {
    minSupportedVersion: {
      ios: semver(process.env.CHECKIN_APP_MIN_VERSION_IOS, '1.0.0'),
      android: semver(process.env.CHECKIN_APP_MIN_VERSION_ANDROID, '1.0.0'),
    },
    storeUrls: {
      ios: process.env.CHECKIN_APP_IOS_URL || null,
      android: process.env.CHECKIN_APP_ANDROID_URL || null,
    },
    signInUrl: `${String(process.env.PUBLIC_SITE_URL || process.env.FRONTEND_URL || '').split(',')[0].replace(/\/+$/, '')}/app-auth`,
    supportUrl: process.env.CHECKIN_APP_SUPPORT_URL || null,
  });
});

module.exports = router;
