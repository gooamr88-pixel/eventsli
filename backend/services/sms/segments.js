/**
 * How many SMS segments a text costs, and in which encoding.
 *
 * Providers bill per SEGMENT, not per message. A message is GSM-7 when every
 * character is in the GSM 03.38 alphabet (160 characters, 153 per part when
 * split); one character outside it — an Arabic letter, an emoji, a curly quote
 * — makes the whole message UCS-2 (70, then 67 per part). The extension table
 * characters (€ [ ] { } and friends) are GSM-7 but count twice.
 *
 * Pure; mirrored for the console's live preview in frontend lib/smsFormat.js,
 * and the two are held together by a test.
 */

const GSM_BASIC = new Set(Array.from(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
));
const GSM_EXTENDED = new Set(Array.from('^{}\\[~]|€\f'));

function analyze(text) {
  const s = String(text ?? '');
  let gsmUnits = 0;
  let gsm = true;
  for (const ch of s) {
    if (GSM_BASIC.has(ch)) gsmUnits += 1;
    else if (GSM_EXTENDED.has(ch)) gsmUnits += 2;
    else { gsm = false; break; }
  }
  if (gsm) {
    return { encoding: 'GSM-7', units: gsmUnits, segments: gsmUnits <= 160 ? 1 : Math.ceil(gsmUnits / 153) };
  }
  const units = s.length;   // UTF-16 code units: an emoji is two
  return { encoding: 'UCS-2', units, segments: units <= 70 ? 1 : Math.ceil(units / 67) };
}

module.exports = { analyze };
