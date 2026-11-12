/**
 * What an inbound reply asks for.
 *
 * Carriers and regulators treat these words as instructions whatever the
 * sender intended: a STOP must stop everything from that sender, a START must
 * undo it, a HELP must be answerable. The lists include the common localised
 * forms for the markets Eventsli sells in (French, Spanish, Arabic).
 *
 * Only the FIRST word counts, so "stop the music" is a STOP — which is what
 * the carriers do too, and the safe side to err on.
 */

const STOP = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPTOUT', 'REVOKE',
  'ARRET', 'ARRÊT', 'BAJA', 'ALTO', 'إلغاء', 'الغاء', 'توقف', 'ايقاف']);
const START = new Set(['START', 'UNSTOP', 'YES', 'SUBSCRIBE', 'OPTIN', 'نعم']);
const HELP = new Set(['HELP', 'INFO', 'AIDE', 'AYUDA', 'مساعدة']);

function classify(text) {
  const first = String(text ?? '')
    .trim()
    .split(/\s+/)[0]
    ?.replace(/[.,!?;:"'()\-_*]+/g, '')
    .toUpperCase();
  if (!first) return null;
  if (STOP.has(first)) return 'stop';
  if (START.has(first)) return 'start';
  if (HELP.has(first)) return 'help';
  return null;
}

module.exports = { classify, STOP, START, HELP };
