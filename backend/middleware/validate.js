const { validationResult } = require('express-validator');
const { sendFail } = require('../utils/responseEnvelope');

/**
 * Turns express-validator's result into the standard failure envelope.
 *
 * `message` carries the FIRST problem, because that is what a form shows at the
 * top; `details` carries all of them keyed by field, because that is what
 * highlights the individual inputs. Returning only one would make a form with
 * three bad fields take three round trips to fix.
 */
function validate(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();

  const all = errors.array();
  return sendFail(res, {
    status: 400,
    error: 'VALIDATION_ERROR',
    message: all[0].msg,
    meta: { details: all.map((e) => ({ field: e.path, message: e.msg })) },
  });
}

module.exports = validate;
