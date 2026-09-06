const express = require('express');
const { body, param } = require('express-validator');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { sendOk, sendFail, ERROR_STATUS } = require('../utils/responseEnvelope');
const c = require('../controllers/ticketController');
const tickets = require('../services/ticketService');
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
 * The ownership check is inside the service and fails CLOSED: an account owner
 * must match `orders.user_id`, or a guest must present the address the tickets
 * were sent to. Neither is inferred from holding the ticket id.
 */
router.post(
  '/:ticketId/transfer',
  param('ticketId').isUUID(),
  body('toEmail').isEmail().normalizeEmail()
    .withMessage('Enter the email of the person you are giving it to.'),
  body('proofEmail').optional().isEmail().normalizeEmail(),
  validate,
  async (req, res, next) => {
    try {
      const result = await tickets.transfer({
        ticketId: req.params.ticketId,
        ownerUserId: req.user.id,
        toEmail: req.body.toEmail,
        // Only used when the order was a guest purchase and so has no user_id
        // to match against. Defaults to the signed-in address, which is the
        // common case for someone who later created an account.
        proofEmail: req.body.proofEmail || req.user.email,
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
