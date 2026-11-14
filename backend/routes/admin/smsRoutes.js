const express = require('express');
const { body, param, query } = require('express-validator');
const validate = require('../../middleware/validate');
const { requireRole } = require('../../middleware/auth');
const { makeLimiter } = require('../../middleware/rateLimit');
const cfg = require('../../controllers/admin/smsConfigController');
const ops = require('../../controllers/admin/smsOpsController');
const camp = require('../../controllers/admin/smsCampaignController');
const prov = require('../../controllers/admin/smsProviderController');
const orgs = require('../../controllers/admin/smsOrganizerController');

/**
 * /api/v1/admin/sms — the Global SMS console.
 *
 * Guarded by routes/admin/index.js (requireAuth + admin). Mount it only there.
 *
 *   every admin       reads everything; drafts campaigns; approves OTHER admins'
 *                     campaigns; sends test texts; adds suppressions
 *   super admin       configures: countries, routes, providers, senders,
 *                     categories, platform settings; imports consent; retries
 *                     uncertain messages; removes admin-added suppressions
 */
const router = express.Router();
const SUPER = requireRole('super_admin');

const ISO2 = param('iso2').customSanitizer((v) => String(v).toUpperCase()).matches(/^[A-Z]{2}$/);
const PROVIDER = param('provider').matches(/^[a-z][a-z0-9_]{1,31}$/);
const UUID = (name = 'id') => param(name).isUUID();
const HOUR = (f) => body(f).optional({ values: 'null' }).isInt({ min: 0, max: 23 });
const testLimit = makeLimiter({ name: 'sms-admin-test', windowMs: 60 * 60_000, max: 20 });

// ─── Overview and analytics ────────────────────────────────────────────────
router.get('/sms/overview', query('days').optional().isIn(['7', '30', '90']), validate, ops.overview);
router.get('/sms/analytics', query('days').optional().isIn(['7', '30', '90', '365']), validate, ops.analytics);

// ─── Countries and routes ──────────────────────────────────────────────────
router.get('/sms/countries',
  query('status').optional().isIn(['unverified', 'enabled', 'disabled', 'blocked', 'ready', 'review_due']),
  query('region').optional().isString().isLength({ max: 40 }),
  validate, cfg.listCountries);
router.post('/sms/countries/bulk-status', SUPER,
  body('iso2s').isArray({ min: 1, max: 250 }), body('iso2s.*').matches(/^[A-Za-z]{2}$/),
  body('status').isIn(['enabled', 'disabled', 'blocked']), validate, cfg.bulkStatus);
router.get('/sms/countries/:iso2', ISO2, validate, cfg.countryDetail);
router.get('/sms/countries/:iso2/history', ISO2, validate, cfg.countryHistory);
router.post('/sms/countries/:iso2/unverify', SUPER, ISO2, body('reason').optional().isString().isLength({ max: 500 }), validate, cfg.unverifyCountry);

const countryBody = [
  body('name').optional().isString().trim().isLength({ min: 2, max: 80 }),
  body('dialCode').optional().matches(/^[1-9][0-9]{0,3}$/),
  body('prefixes').optional().isArray({ max: 200 }),
  body('prefixes.*').optional().matches(/^[1-9][0-9]{1,9}$/),
  body('dialPrimary').optional().isBoolean(),
  body('region').optional().isString().isLength({ min: 2, max: 40 }),
  body('timezone').optional().isString().isLength({ min: 2, max: 60 }),
  body('senderIdSupport').optional().isIn(['unknown', 'supported', 'registration_required', 'not_supported']),
  body('requiresSenderRegistration').optional().isBoolean(),
  body('marketingAllowed').optional().isBoolean(),
  body('doubleOptInRequired').optional().isBoolean(),
  HOUR('quietHoursStart'), HOUR('quietHoursEnd'),
  body('restrictions').optional({ values: 'null' }).isString().isLength({ max: 2000 }),
  body('notes').optional({ values: 'null' }).isString().isLength({ max: 2000 }),
  body('maxDailyMessages').optional({ values: 'null' }).isInt({ min: 1, max: 10_000_000 }),
];
router.post('/sms/countries', SUPER, body('iso2').matches(/^[A-Za-z]{2}$/), body('name').isString().trim().isLength({ min: 2, max: 80 }),
  body('dialCode').matches(/^[1-9][0-9]{0,3}$/), ...countryBody, validate, cfg.createCountry);
router.patch('/sms/countries/:iso2', SUPER, ISO2, ...countryBody, validate, cfg.updateCountry);
router.post('/sms/countries/:iso2/verify', SUPER, ISO2,
  body('source').isString().trim().isLength({ min: 5, max: 500 }).withMessage('Say what you checked: a guideline URL or a provider ticket.'),
  body('notes').optional().isString().isLength({ max: 2000 }), validate, cfg.verifyCountry);
router.post('/sms/countries/:iso2/status', SUPER, ISO2, body('status').isIn(['enabled', 'disabled', 'blocked']),
  body('reason').optional().isString().isLength({ max: 500 }), validate, cfg.setCountryStatus);
router.post('/sms/countries/:iso2/resume', SUPER, ISO2, validate, cfg.resumeCountry);
router.put('/sms/countries/:iso2/routes/:provider', SUPER, ISO2, PROVIDER,
  body('priority').optional().isInt({ min: 0, max: 1000 }),
  body('senderId').optional({ values: 'null' }).isUUID(),
  body('costMicros').optional({ values: 'null' }).isInt({ min: 0, max: 100_000_000 }),
  body('currency').optional({ values: 'null' }).matches(/^[A-Za-z]{3}$/),
  body('active').optional().isBoolean(), body('verified').optional().isBoolean(),
  body('notes').optional({ values: 'null' }).isString().isLength({ max: 1000 }),
  validate, cfg.upsertRoute);
router.delete('/sms/countries/:iso2/routes/:provider', SUPER, ISO2, PROVIDER, validate, cfg.deleteRoute);

// ─── Providers and senders ─────────────────────────────────────────────────
router.get('/sms/providers', cfg.listProviders);
router.patch('/sms/providers/:provider', SUPER, PROVIDER,
  body('enabled').optional().isBoolean(), body('priority').optional().isInt({ min: 0, max: 1000 }),
  body('maxTps').optional().isInt({ min: 1, max: 1000 }),
  body('trafficClasses').optional().isArray({ min: 1, max: 2 }), body('trafficClasses.*').optional().isIn(['transactional', 'marketing']),
  validate, cfg.updateProvider);
router.post('/sms/providers/:provider/reset', SUPER, PROVIDER, validate, cfg.resetCircuit);
// Credentials: write-only secrets, encrypted at rest; tests and number listing are read-only calls.
const credBody = ['accountSid', 'authToken', 'apiKeySid', 'apiKeySecret', 'apiKey', 'apiSecret', 'signatureSecret', 'signatureMethod', 'currency']
  .map((f) => body(f).optional({ values: 'falsy' }).isString().isLength({ max: 200 }));
router.put('/sms/providers/:provider/credentials', SUPER, PROVIDER, ...credBody, validate, prov.saveCredentials);
router.delete('/sms/providers/:provider/credentials', SUPER, PROVIDER, validate, prov.deleteCredentials);
router.post('/sms/providers/:provider/test', SUPER, PROVIDER, ...credBody, validate, prov.testConnection);
router.get('/sms/providers/:provider/numbers', SUPER, PROVIDER, validate, prov.listNumbers);
router.post('/sms/providers/:provider/numbers/import', SUPER, PROVIDER,
  body('numbers').isArray({ min: 1, max: 200 }),
  body('numbers.*.value').isString().isLength({ min: 3, max: 64 }),
  body('numbers.*.kind').isIn(['messaging_service', 'short_code', 'toll_free', 'long_code', 'alphanumeric']),
  body('numbers.*.label').optional({ values: 'null' }).isString().isLength({ max: 80 }),
  body('numbers.*.country').optional({ values: 'null' }).isString().isLength({ max: 2 }),
  validate, prov.importNumbers);

// ─── Organizer access ──────────────────────────────────────────────────────
router.get('/sms/organizers', query('q').optional().isString().isLength({ max: 100 }), validate, orgs.listOrganizers);
router.put('/sms/organizers/:organizerId', SUPER, param('organizerId').isUUID(),
  body('enabled').optional().isBoolean({ strict: true }),
  body('monthlyCap').optional().isInt({ min: 0, max: 10_000_000 }),
  body('categories').optional().isArray({ max: 2 }), body('categories.*').optional().isIn(['marketing', 'segmentation']),
  body('note').optional({ values: 'null' }).isString().isLength({ max: 500 }),
  validate, orgs.setAccess);
router.post('/sms/providers/:provider/sync-pricing', SUPER, PROVIDER,
  body('country').optional().matches(/^[A-Za-z]{2}$/), validate, cfg.syncPricing);

const senderBody = [
  body('kind').optional().isIn(['messaging_service', 'short_code', 'toll_free', 'long_code', 'alphanumeric']),
  body('value').optional().isString().trim().isLength({ min: 1, max: 64 }),
  body('label').optional({ values: 'null' }).isString().isLength({ max: 80 }),
  body('trafficClasses').optional().isArray({ min: 1, max: 2 }), body('trafficClasses.*').optional().isIn(['transactional', 'marketing']),
  body('countries').optional().isArray({ max: 250 }), body('countries.*').optional().matches(/^[A-Za-z]{2}$/),
  body('registrationStatus').optional().isIn(['not_required', 'pending', 'approved', 'rejected', 'expired']),
  body('registrationReference').optional({ values: 'null' }).isString().isLength({ max: 200 }),
  body('approvedAt').optional({ values: 'null' }).isISO8601(), body('expiresAt').optional({ values: 'null' }).isISO8601(),
  body('active').optional().isBoolean(), body('notes').optional({ values: 'null' }).isString().isLength({ max: 1000 }),
];
router.get('/sms/senders', cfg.listSenders);
router.post('/sms/senders', SUPER, body('providerId').matches(/^[a-z][a-z0-9_]{1,31}$/), body('kind').exists(), body('value').exists(),
  ...senderBody, validate, cfg.createSender);
router.patch('/sms/senders/:id', SUPER, UUID(), ...senderBody, validate, cfg.updateSender);
router.delete('/sms/senders/:id', SUPER, UUID(), validate, cfg.deleteSender);

// ─── Categories and settings ───────────────────────────────────────────────
router.get('/sms/categories', cfg.listCategories);
router.patch('/sms/categories/:key', SUPER, param('key').isIn(['participant', 'event_notification', 'marketing', 'segmentation']),
  body('enabled').optional().isBoolean(), body('requiresApproval').optional().isBoolean(),
  body('requiresConsent').optional().isBoolean({ strict: true }),
  body('minRole').optional().isIn(['admin', 'super_admin']),
  body('perRecipientDailyLimit').optional().isInt({ min: 1, max: 100 }),
  body('respectQuietHours').optional().isBoolean(), body('maxSegments').optional().isInt({ min: 1, max: 10 }),
  body('label').optional().isString().isLength({ min: 2, max: 60 }), body('description').optional().isString().isLength({ min: 2, max: 200 }),
  validate, cfg.updateCategory);
router.get('/sms/settings', cfg.getSettings);
router.patch('/sms/settings', SUPER,
  body('sendingEnabled').optional().isBoolean(), body('brandName').optional().isString().trim().isLength({ min: 1, max: 30 }),
  body('optOutText').optional().isString().trim().isLength({ min: 4, max: 60 }),
  body('helpText').optional().isString().trim().isLength({ min: 10, max: 160 }), body('replyToHelp').optional().isBoolean(),
  body('defaultQuietStart').optional().isInt({ min: 0, max: 23 }), body('defaultQuietEnd').optional().isInt({ min: 0, max: 23 }),
  body('countryHourlyLimit').optional().isInt({ min: 1, max: 1_000_000 }),
  body('dailyMarketingCapMicros').optional({ values: 'null' }).isInt({ min: 0 }),
  body('spendCurrency').optional().matches(/^[A-Za-z]{3}$/),
  body('reminderHoursBefore').optional().isInt({ min: 1, max: 168 }),
  body('maxCampaignRecipients').optional().isInt({ min: 1, max: 5_000_000 }),
  body('messageRetentionDays').optional({ values: 'null' }).isInt({ min: 30, max: 3650 }),
  body('stopConfirmationProviders').optional().isArray({ max: 10 }),
  body('stopConfirmationProviders.*').optional().isIn(['twilio', 'vonage']),
  body('stopConfirmationText').optional().isString().trim().isLength({ min: 10, max: 160 }),
  validate, cfg.updateSettings);

// ─── Messages ──────────────────────────────────────────────────────────────
router.get('/sms/messages',
  query('status').optional().isIn(['queued', 'sending', 'sent', 'delivered', 'undelivered', 'failed', 'unknown', 'blocked', 'cancelled']),
  query('category').optional().isIn(['participant', 'event_notification', 'marketing', 'segmentation']),
  query('country').optional().matches(/^[A-Z]{2}$/), query('provider').optional().matches(/^[a-z][a-z0-9_]{1,31}$/),
  query('campaignId').optional().isUUID(), query('phone').optional().isString().isLength({ max: 30 }),
  validate, ops.listMessages);
router.get('/sms/messages/:id', UUID(), validate, ops.messageDetail);
router.post('/sms/messages/:id/retry', SUPER, UUID(), body('acceptDuplicateRisk').optional().isBoolean(), validate, ops.retryMessage);
router.post('/sms/messages/:id/cancel', UUID(), validate, ops.cancelMessage);
router.post('/sms/test', testLimit,
  body('to').isString().isLength({ min: 6, max: 30 }), body('body').isString().trim().isLength({ min: 1, max: 1000 }),
  body('category').optional().isIn(['participant', 'event_notification', 'marketing', 'segmentation']),
  validate, ops.sendTest);

// ─── Compliance ────────────────────────────────────────────────────────────
router.get('/sms/suppressions', query('reason').optional().isString().isLength({ max: 30 }), validate, ops.listSuppressions);
router.post('/sms/suppressions', body('phone').isString().isLength({ min: 6, max: 30 }), body('scope').isIn(['all', 'marketing']),
  body('reason').optional().isIn(['admin', 'fraud', 'invalid_number']), body('note').optional().isString().isLength({ max: 500 }),
  validate, ops.addSuppression);
router.delete('/sms/suppressions/:key', SUPER, param('key').isString().isLength({ min: 8, max: 40 }), validate, ops.removeSuppression);
router.get('/sms/consents', query('phone').isString().isLength({ min: 6, max: 30 }), validate, ops.lookupConsent);
router.post('/sms/consents/import', SUPER,
  body('phones').isArray({ min: 1, max: 5000 }), body('phones.*').isString().isLength({ max: 40 }),
  body('scope').optional().matches(/^(platform|[0-9a-f-]{36})$/), body('defaultCountry').optional().matches(/^[A-Z]{2}$/),
  body('evidence').isString().trim().isLength({ min: 20, max: 1000 }).withMessage('Describe how and when this consent was collected (20+ characters).'),
  validate, ops.importConsents);

// ─── Segments and campaigns ────────────────────────────────────────────────
const segmentBody = [
  body('name').isString().trim().isLength({ min: 2, max: 80 }),
  body('description').optional({ values: 'null' }).isString().isLength({ max: 500 }),
  body('definition').optional().isObject(),
];
router.get('/sms/segments', camp.listSegments);
router.post('/sms/segments', ...segmentBody, validate, camp.saveSegment);
router.patch('/sms/segments/:id', UUID(), ...segmentBody, validate, camp.saveSegment);
router.delete('/sms/segments/:id', UUID(), validate, camp.deleteSegment);
router.post('/sms/segments/preview', body('definition').isObject(), validate, camp.previewSegment);
router.post('/sms/segments/:id/preview', UUID(), validate, camp.previewSegment);

const campaignBody = [
  body('name').isString().trim().isLength({ min: 2, max: 120 }),
  body('category').isIn(['marketing', 'segmentation']),
  body('body').isString().trim().isLength({ min: 1, max: 1000 }),
  body('segmentId').optional({ values: 'null' }).isUUID(),
  // Platform campaigns use Eventsli consent only (see smsCampaignController).
  body('consentScope').optional().equals('platform'),
  body('scheduledAt').optional({ values: 'null' }).isISO8601(),
];
router.get('/sms/campaigns', query('status').optional().isString().isLength({ max: 30 }), validate, camp.listCampaigns);
router.post('/sms/campaigns', ...campaignBody, validate, camp.saveCampaign);
router.patch('/sms/campaigns/:id', UUID(), ...campaignBody, validate, camp.saveCampaign);
router.post('/sms/campaigns/:id/submit', UUID(), validate, camp.submitCampaign);
router.post('/sms/campaigns/:id/approve', UUID(), body('note').optional().isString().isLength({ max: 1000 }), validate, camp.approveCampaign);
router.post('/sms/campaigns/:id/reject', UUID(), body('note').isString().trim().isLength({ min: 5, max: 1000 }), validate, camp.rejectCampaign);
router.post('/sms/campaigns/:id/cancel', UUID(), validate, camp.cancelCampaign);

module.exports = router;
