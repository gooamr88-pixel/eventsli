const express = require('express');
const { body, param } = require('express-validator');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { sendOk, sendFail, ERROR_STATUS } = require('../utils/responseEnvelope');
const c = require('../controllers/ticketController');
const tickets = require('../services/ticketService');
const access = require('../services/accessTokens');
const email = require('../services/emailService');
const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');

const router = express.Router();

// Everything here is the buyer's own. A session proves who they are; the
// controller additionally matches on the address they bought with as a guest,
// so a purchase made before signing up still appears.
router.use(requireAuth);

router.get('/', c.mine);

/**
 * BRD §10 — a ticket may be passed on ONCE.
 *
 * The ownership check is inside the service and fails CLOSED (see
 * utils/ticketTransfer.js): the account that bought it, or — for a guest
 * purchase — a verified account on the buyer's address, or the signed order
 * token from the confirmation email. Never a typed address: `proofEmail` was
 * accepted here until 2026-11-05, which let anyone who knew the buyer's email
 * (the organizer sees it on the door list) move their ticket. It is refused
 * now rather than ignored, so an old client fails loudly instead of quietly.
 */
router.post(
  '/:ticketId/transfer',
  param('ticketId').isUUID(),
  body('toEmail').isEmail().normalizeEmail()
    .withMessage('Enter the email of the person you are giving it to.'),
  body('proofEmail').not().exists()
    .withMessage('Prove the ticket with your account or the link in your confirmation email.'),
  body('orderToken').optional().isString().isLength({ min: 20, max: 2000 }),
  validate,
  async (req, res, next) => {
    try {
      const result = await tickets.transfer({
        ticketId: req.params.ticketId,
        ownerUserId: req.user.id,
        // From the session, never the body: login refuses an unverified
        // account, so this address is proven to be theirs.
        ownerEmail: req.user.email,
        // A forged, expired or foreign token reads as null and proves nothing.
        tokenOrderId: req.body.orderToken ? access.readOrderToken(req.body.orderToken) : null,
        toEmail: req.body.toEmail,
      });

      // BRD §10 — both parties are told. Best-effort: the transfer has already
      // happened and must not be undone because an email provider was down.
      const { data: t } = await supabase
        .from('tickets').select('events ( title, slug )').eq('id', req.params.ticketId).maybeSingle();
      const event = t?.events || { title: 'your event' };

      for (const [to, direction, counterparty] of [
        [result.from, 'sent', result.to],
        [result.to, 'received', result.from],
      ]) {
        if (!to) continue;
        email.sendTicketTransferred({ to, event, direction, counterparty })
          .catch((e) => logger.error({ err: e.message }, 'transfer notice failed'));
      }

      return sendOk(res, {
        transferred: true,
        to: result.to,
        transferredAt: result.transferredAt,
        note: 'This ticket cannot be transferred again.',
      });
    } catch (err) {
      if (err.code) {
        return sendFail(res, {
          status: ERROR_STATUS[err.code] || 400, error: err.code, message: err.message,
        });
      }
      return next(err);
    }
  },
);

module.exports = router;
