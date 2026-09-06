const pino = require('pino');

/**
 * Structured JSON logs in production, human-readable in development.
 *
 * Every log line carries `service` so a shared log drain can tell this API
 * apart from the frontend and the scheduled workers.
 */
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
    : undefined,
  base: { service: 'eventsli-api' },
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  /**
   * Anything matching these paths is replaced before it reaches disk.
   *
   * Money bugs get debugged by logging the whole request body, and a checkout
   * body carries buyer contact details and a table password. Redaction is set
   * here, once, so no future `logger.info({ req.body })` can leak them.
   */
  redact: {
    paths: [
      'password', '*.password', '*.password_hash',
      'token', '*.token', 'authorization', 'req.headers.authorization',
      'req.headers.cookie', '*.stripe_secret', '*.service_role_key',
      'guest_email', '*.guest_email', 'guest_phone', '*.guest_phone',
      'table_password', '*.table_password',
    ],
    censor: '[redacted]',
  },
});

module.exports = logger;
