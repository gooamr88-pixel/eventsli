const express = require('express');
const { webhook } = require('../controllers/paymentController');

const router = express.Router();

/**
 * No auth middleware, no rate limiter, no body validation.
 *
 * The Stripe signature IS the authentication — verified in the handler over the
 * raw bytes captured by the express.json verify hook in app.js. Adding a body
 * validator here would be worse than useless: it would reject payloads Stripe
 * legitimately sends as their API evolves, and it cannot tell a real event from
 * a forged one anyway. Only the signature can.
 *
 * app.js also exempts this path from the general rate limiter: Stripe retries
 * on any non-2xx and can burst on a busy event, and a throttled webhook is a
 * paid order that never becomes a ticket.
 */
router.post('/webhook', webhook);

module.exports = router;
