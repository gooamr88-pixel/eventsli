/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE EMAIL DESIGN SYSTEM — one identity for every message the platform sends.
 *
 * Eleven emails were eleven hand-written `<div>`s sharing a three-line `shell`.
 * None carried the logo or the name, none showed the event they were about
 * beyond its title, and a buyer's ticket said `[object Object]` where the seat
 * should be. This is the header, the footer, the blocks and the rules, once.
 *
 * ── WHY EMAIL HTML LOOKS LIKE 2004 ──────────────────────────────────────────
 *
 * Every constraint below is a mail client, not a preference:
 *
 *   TABLES, not flexbox or grid. Outlook on Windows renders through Word,
 *   which supports neither. A card built from divs collapses to full width
 *   there — for a large share of exactly the organizers who buy from us.
 *
 *   INLINE STYLES, never a <style> block. Gmail strips <style> on its mobile
 *   apps, and a ticket that arrives unstyled is one a guest cannot read at a
 *   dark venue door.
 *
 *   NO SVG. Outlook and Gmail drop it. The logo is a PNG, and the wordmark is
 *   TEXT — which also means the brand still reads when a client blocks images,
 *   which Gmail does by default for any sender it has not seen before.
 *
 *   NO WEB FONTS. The stack falls back to what the device has.
 *
 * ── DARK MODE ───────────────────────────────────────────────────────────────
 *
 * Gmail on Android inverts light emails wholesale, which is how the ticket in
 * the screenshot ended up white-on-black with a washed-out brand colour. There
 * is no way to forbid it, but there is a way to survive it: state an explicit
 * `background-color` AND `color` on every container that holds text. An element
 * with only one of the two is the one the client re-colours in half, producing
 * grey on grey. Belt and braces with `color-scheme` in the head, which the
 * clients that honour it use to leave us alone entirely.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { minorUnits } = require('../utils/markets');

/**
 * The storefront's palette (frontend `globals.css`), named the same way.
 *
 * THE WHITE / YELLOW / CORAL BRAND since 2026-11-15 (the approved brand
 * sheet). `BRAND` is the site's text-safe coral (--es-accent, #D61F2C): the
 * sheet's #FF414B carries white at only 3.44:1, so a button label on it would
 * fail AA. White on #D61F2C is 5.13:1. `HIGHLIGHT` is the sheet's yellow, used
 * only as a fill (the bar over the masthead). `BRAND_TINT` is the pale yellow
 * for secondary words ON the coral (4.61:1), for the ticket's header row.
 * SUBTLE is the site's subtle text (6.2:1 on white).
 */
const BRAND = '#d61f2c';
const BRAND_DARK = '#b5121e';
const BRAND_TINT = '#fff3c4';
const HIGHLIGHT = '#ffcc00';
const INK = '#111018';
const MUTED = '#4a4a55';
const SUBTLE = '#60606b';
const LINE = '#eaeaea';
const SURFACE = '#ffffff';
const SUNKEN = '#f5f5f5';
const WARN_BG = '#fef6e7';
const WARN_LINE = '#b45309';
const DANGER_BG = '#fdecec';
const DANGER_LINE = '#b42318';
/* The site's yellow wash (--es-highlight-wash) and its edge, for the event
   card; and the printable ticket's paper, frame and tear-off (PrintableTicket
   on the confirmation page), so the ticket in the inbox is the same ticket. */
const HIGHLIGHT_WASH = '#fffbea';
const HIGHLIGHT_LINE = '#ffe58a';
const PAPER = '#fff8dc';
const PAPER_FRAME = '#ffd94d';
const STUB = '#ffe0e2';

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Courier New',monospace";

/**
 * Every value interpolated into an email is escaped.
 *
 * An event title is organizer-controlled text going into HTML that lands in
 * somebody else's inbox. Mail clients are inconsistent about what they
 * execute, and the safe assumption is that some of them will.
 */
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** `FRONTEND_URL` may be a comma-separated list; the first is canonical. */
function siteUrl() {
  return (process.env.FRONTEND_URL || '').split(',')[0].replace(/\/+$/, '');
}

function apiUrl() {
  return (process.env.BACKEND_URL || '').replace(/\/+$/, '');
}

function money(cents, currency) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return '';
  // Minor units: two decimals for most currencies, none for the yen, three for
  // the dinar (utils/markets.js).
  const digits = minorUnits(currency || 'CAD');
  try {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency', currency: currency || 'CAD', minimumFractionDigits: digits, maximumFractionDigits: digits,
    }).format(n / 10 ** digits);
  } catch {
    // An unknown currency code must not take an email down with it.
    return `${(n / 10 ** digits).toFixed(digits)} ${currency || ''}`.trim();
  }
}

/**
 * A time, in the EVENT's zone, with the zone named.
 *
 * The same rule the whole product follows: a show at 4pm in San Diego is at
 * 4pm on the poster, on the ticket and at the door. An email rendered in the
 * server's zone — or the reader's — is how people miss events.
 */
function whenText(startsAt, timezone, { withZone = true } = {}) {
  if (!startsAt) return null;
  const at = new Date(startsAt);
  if (Number.isNaN(at.getTime())) return null;
  try {
    const text = new Intl.DateTimeFormat('en-CA', {
      dateStyle: 'full', timeStyle: 'short', timeZone: timezone || 'UTC',
    }).format(at);
    return withZone && timezone ? `${text} (${timezone})` : text;
  } catch {
    return new Intl.DateTimeFormat('en-CA', { dateStyle: 'full', timeStyle: 'short' }).format(at);
  }
}

/**
 * A coming-soon event's rough date: "Coming soon · March 2027". The month is
 * the one at the venue — the teaser's dates are that whole month there.
 */
function monthText(startsAt, timezone) {
  if (!startsAt) return null;
  const at = new Date(startsAt);
  if (Number.isNaN(at.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('en-CA', { month: 'long', year: 'numeric', timeZone: timezone || 'UTC' }).format(at);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { month: 'long', year: 'numeric' }).format(at);
  }
}

/**
 * THE SEAT, AS A PERSON READS IT — and the reason this file exists at all.
 *
 * `ticketService.shape()` returns `seat` as an OBJECT: `{ section, row,
 * number }`. The ticket email interpolated it straight into a template
 * literal, so every buyer with an assigned seat received a ticket reading
 * "[object Object] · Table T1". It had nothing to do with the QR code, so the
 * ticket scanned perfectly and nobody found it from the door.
 *
 * The rules match the frontend's `TicketStub`: a whole-table booking is named
 * by its table, and `row_label` is 'A' for every table-attached seat, so
 * repeating it beside a section that is already the table's name reads as
 * noise.
 */
function seatLabel(ticket) {
  const parts = [];
  if (ticket?.table) parts.push(`Table ${ticket.table}`);

  const seat = ticket?.seat;
  if (seat && typeof seat === 'object') {
    const { section, row, number } = seat;
    // A table-attached seat's SECTION is the table's own label, so on a table
    // booking it is already the first half of this line — "Table T1 · T1 ·
    // seat 3" says T1 twice and reads as a rendering fault of its own.
    const bit = [];
    if (section && section !== ticket.table) bit.push(section);
    if (row && row !== 'A') bit.push(`row ${row}`);
    if (number !== null && number !== undefined) bit.push(`seat ${number}`);
    if (bit.length) parts.push(bit.join(' · '));
  } else if (typeof seat === 'string' && seat.trim()) {
    // Tolerated rather than assumed: a caller that already formatted it should
    // not have its string turned into "[object Object]" by a stricter check.
    parts.push(seat.trim());
  }

  if (parts.length === 0) return 'General admission';
  return parts.join(' · ');
}

/* ── Blocks ──────────────────────────────────────────────────────────────── */

/**
 * The masthead: a yellow bar, the mark, then the name in type with its tagline.
 *
 * The NAME IS TEXT, not part of the image, and that is deliberate. Gmail
 * blocks images from an unknown sender by default, so a logo-as-image
 * masthead is a blank strip on the first email anybody ever gets from us —
 * which is the one that has to look legitimate.
 *
 * THE REAL LOGO (2026-11-15): `email-logo.png` is the site's lockup — the
 * yellow E ticket, "eventsli" in Urbanist with its spark — rendered from the
 * same paths by frontend/scripts/brandIcons.js, because mail clients drop the
 * SVG. When a client blocks images the ALT TEXT stands in, styled as the
 * name (lowercase, extra-bold, near-black), so the first email still says
 * who it is from. DISCOVER - BOOK - ENJOY stays as text under it.
 *
 * The 4px bar above is the brand yellow, the sheet's highlight colour. A filled cell rather than a border, because Outlook draws a border-top
 * on a rounded table as a square line poking out of the corners.
 */
function header() {
  const logo = `${siteUrl()}/email-logo.png`;
  return `
  <tr>
    <td style="height:6px;line-height:6px;font-size:0;background-color:${HIGHLIGHT}" bgcolor="${HIGHLIGHT}">&nbsp;</td>
  </tr>
  <tr>
    <td style="padding:26px 32px 22px;background-color:${SURFACE}">
      <img src="${logo}" width="179" height="40" alt="eventsli"
           style="display:block;width:179px;height:40px;border:0;font-family:${FONT};font-size:24px;line-height:40px;font-weight:800;letter-spacing:-0.02em;color:${INK}" />
      <span style="display:block;margin-top:6px;font-family:${FONT};font-size:9px;line-height:1.2;font-weight:700;letter-spacing:0.18em;color:${MUTED}">DISCOVER - BOOK - ENJOY</span>
    </td>
  </tr>`;
}

/**
 * The footer.
 *
 * Says WHO sent this and WHY it arrived. A transactional email with no reason
 * for being in the inbox is one people report as spam, and a sender reputation
 * is lost one report at a time — on the domain that also delivers tickets.
 */
function footer(reason) {
  const site = siteUrl();
  return `
  <tr>
    <td style="padding:24px 32px 32px;background-color:${SURFACE};border-top:1px solid ${LINE}">
      <p style="margin:0 0 8px;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED}">
        ${escapeHtml(reason || 'You are receiving this because of activity on your Eventsli account.')}
      </p>
      <p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;color:${SUBTLE}">
        <a href="${site}" style="color:${BRAND};text-decoration:none">Eventsli</a>
        &nbsp;·&nbsp;
        <a href="${site}/how-it-works" style="color:${SUBTLE};text-decoration:underline">How it works</a>
        &nbsp;·&nbsp;
        <a href="${site}/contact" style="color:${SUBTLE};text-decoration:underline">Contact</a>
        &nbsp;·&nbsp;
        <a href="${site}/terms" style="color:${SUBTLE};text-decoration:underline">Terms</a>
      </p>
    </td>
  </tr>`;
}

/**
 * The whole document.
 *
 * `preheader` is the grey line an inbox shows after the subject. Left unset a
 * client scrapes the first text it finds, which on a ticket email is "Hi
 * there" — a wasted second line on every message in a crowded inbox. The span
 * is hidden by being zero-height and transparent, which is the one technique
 * that works across clients; the run of nbsp after it stops the client
 * back-filling body text behind it.
 */
function layout({ title, preheader, body, reason }) {
  return `<!DOCTYPE html>
<html lang="en" style="margin:0;padding:0">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:${SUNKEN};color:${INK}">
  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all">
    ${escapeHtml(preheader || '')}
  </span>
  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all">
    ${'&#847;&zwnj;&nbsp;'.repeat(40)}
  </span>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
         style="background-color:${SUNKEN};margin:0;padding:0">
    <tr>
      <td align="center" style="padding:24px 12px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"
               style="width:100%;max-width:600px;background-color:${SURFACE};border:1px solid ${LINE};border-radius:14px;overflow:hidden">
          ${header()}
          <tr>
            <td style="padding:0 32px 8px;background-color:${SURFACE}">
              <h1 style="margin:0 0 16px;font-family:${FONT};font-size:24px;line-height:1.25;font-weight:800;letter-spacing:-0.02em;color:${INK}">
                ${escapeHtml(title)}
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 8px;background-color:${SURFACE};font-family:${FONT};font-size:15px;line-height:1.65;color:${INK}">
              ${body}
            </td>
          </tr>
          ${footer(reason)}
        </table>

        <p style="margin:16px 0 0;font-family:${FONT};font-size:11px;color:${SUBTLE}">
          Eventsli · Tickets and seat maps for events worldwide
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** A paragraph, in the body's own type. */
function p(html, { small = false, color = INK } = {}) {
  return `<p style="margin:0 0 14px;font-family:${FONT};font-size:${small ? '13px' : '15px'};line-height:1.65;color:${color}">${html}</p>`;
}

/**
 * A button that survives Outlook.
 *
 * Built as a table with the background on the `<td>`, not as a styled anchor:
 * Word's renderer drops `padding` on an inline element, so the anchor version
 * arrives as bare blue text on exactly the clients least likely to forgive it.
 */
function button(href, label) {
  if (!href) return '';
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px">
    <tr>
      <td align="center" bgcolor="${BRAND}" style="background-color:${BRAND};border-radius:999px">
        <a href="${escapeHtml(href)}"
           style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:15px;font-weight:700;line-height:1;color:#ffffff;text-decoration:none;border-radius:999px">
          ${escapeHtml(label)}
        </a>
      </td>
    </tr>
  </table>`;
}

/**
 * THE EVENT, AT A GLANCE — on every email that is about one.
 *
 * This is the block the whole redesign is for. A message saying an event was
 * approved, or a ticket transferred, or an invoice raised, used to name the
 * event and nothing else — so the reader had to remember which of their events
 * "Cruise Meeting" was, and a buyer had no date or address anywhere in the
 * email they were told to keep.
 *
 * Every row is omitted when its value is missing rather than shown empty: a
 * label with nothing after it reads as information that was lost.
 */
function eventCard(event = {}) {
  if (!event.title) return '';
  // A teaser has a month, not a time — printing "Monday, March 1 at 12:00 a.m."
  // would state as fact a time nobody chose.
  const teaser = event.comingSoon === true || event.coming_soon === true;
  const startsAt = event.startsAt ?? event.starts_at;
  const month = teaser ? monthText(startsAt, event.timezone) : null;
  const when = teaser ? (month ? `Coming soon · ${month}` : 'Coming soon') : whenText(startsAt, event.timezone);
  const venue = teaser ? null : (event.venue ?? event.venue_name);
  const place = [venue, event.city].filter(Boolean).join(', ');
  const site = siteUrl();
  const href = event.slug && site ? `${site}/e/${encodeURIComponent(event.slug)}` : null;

  const row = (label, value) => (value ? `
    <tr>
      <td style="padding:2px 0;font-family:${FONT};font-size:12px;line-height:1.5;color:${SUBTLE};width:74px;vertical-align:top">${label}</td>
      <td style="padding:2px 0;font-family:${FONT};font-size:13px;line-height:1.5;color:${INK}">${escapeHtml(value)}</td>
    </tr>` : '');

  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
         style="width:100%;margin:0 0 20px;background-color:${HIGHLIGHT_WASH};border:1px solid ${HIGHLIGHT_LINE};border-radius:14px">
    <tr>
      <td style="padding:16px 18px;background-color:${HIGHLIGHT_WASH}">
        <p style="margin:0 0 10px;font-family:${FONT};font-size:17px;font-weight:800;line-height:1.3;color:${INK}">
          ${escapeHtml(event.title)}
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          ${row('When', when)}
          ${row('Where', place)}
          ${row('Organizer', event.organizerName)}
        </table>
        ${href ? `<p style="margin:12px 0 0;font-family:${FONT};font-size:13px">
          <a href="${href}" style="color:${BRAND};text-decoration:none;font-weight:600">View the event page &rarr;</a>
        </p>` : ''}
      </td>
    </tr>
  </table>`;
}

/**
 * One ticket: the code that opens the door, and what it admits.
 *
 * DRAWN AS THE CONFIRMATION PAGE DRAWS IT (PrintableTicket, the owner's
 * reference, 2026-11-15): pale-yellow paper inside a yellow frame, the ticket
 * type, the event in a starred heading with "Tickets" in coral over a coral
 * rule, the holder and the place as labelled lines, a dotted rule and the
 * start time — then the tear-off, in the pale coral, with the code on white
 * and "Scan at entry". Stacked rather than side by side: a two-column table
 * squeezes the code on a phone, and the code is the part that has to scan.
 *
 * The QR comes from OUR domain. It used to come from a public QR generator
 * with the signed admission token in the query string — handing a third party
 * the credential that opens the door for every ticket ever sold. The code
 * never sits on colour: a scanner reads contrast, not branding.
 *
 * `event` and `free` are optional; without them the ticket shows only what
 * is on it.
 */
function ticketCard(ticket, { index, total, event = null, free = false } = {}) {
  const api = apiUrl();
  const src = `${api}/api/v1/public/qr/${encodeURIComponent(ticket.qr)}.png`;
  const label = seatLabel(ticket);
  // 'General admission' under a ticket type that already says so reads as a
  // rendering fault (TicketStub's rule).
  const seatLine = label === 'General admission' && /general|admission/i.test(ticket.tierName || '') ? null : label;
  const counter = total > 1 ? `Ticket ${index + 1} of ${total}` : 'Admits one';
  const title = event?.title;
  const when = event ? whenText(event.startsAt ?? event.starts_at, event.timezone) : null;
  const venue = event ? (event.venue ?? event.venue_name) : null;
  const address = event ? (event.venueAddress ?? event.venue_address ?? event.city) : null;

  const line = (name, value, { coral = false } = {}) => (value ? `
        <p style="margin:0 0 6px;font-family:${FONT};font-size:14px;line-height:1.5;color:${MUTED}">
          ${name}: <strong style="color:${coral ? BRAND : INK}">${escapeHtml(value)}</strong>
        </p>` : '');

  return `
  <p style="margin:0 0 6px;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED}">${escapeHtml(counter)}</p>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
         style="width:100%;margin:0 0 22px;background-color:${PAPER};border-radius:8px;overflow:hidden">
    <tr>
      <td bgcolor="${PAPER}" style="padding:12px;background-color:${PAPER}">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
               style="width:100%;border:2px solid ${PAPER_FRAME};border-radius:14px">
          <tr>
            <td align="center" style="padding:18px 18px 16px;background-color:${PAPER}">
              ${ticket.tierName ? `<p style="margin:0 0 10px;font-family:${FONT};font-size:13px;line-height:1.4;color:${MUTED}">Ticket type: <strong style="color:${INK}">${escapeHtml(ticket.tierName)}</strong></p>` : ''}
              ${title ? `<p style="margin:0 0 14px;padding-bottom:6px;border-bottom:3px solid ${BRAND};font-family:${FONT};font-size:21px;line-height:1.25;font-weight:800;color:${INK}">
                &#9733; <span style="color:${BRAND}">Tickets</span> ${escapeHtml(title)} &#9733;
              </p>` : ''}
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr><td style="text-align:left;background-color:${PAPER}">
                  ${line('Name', ticket.attendeeName)}
                  ${free ? line('Price', 'Free ticket', { coral: true }) : ''}
                  ${line('Seat', seatLine)}
                  ${line('Includes', (ticket.addons || []).join(', '), { coral: true })}
                  ${line('Location', venue)}
                  ${line('Address', address)}
                </td></tr>
              </table>
              <p style="margin:10px 0 8px;font-family:${FONT};font-size:16px;line-height:1;letter-spacing:8px;color:${BRAND}">&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;</p>
              ${when ? `<p style="margin:0;font-family:${FONT};font-size:14px;line-height:1.5;color:${INK}">Starts ${escapeHtml(when)}</p>` : ''}
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td align="center" bgcolor="${STUB}" style="padding:18px 18px 16px;background-color:${STUB};border-top:2px dashed ${PAPER_FRAME}">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td align="center" bgcolor="#ffffff" style="padding:12px;background-color:#ffffff;border-radius:12px">
              <img src="${src}" alt="Entry code for ${escapeHtml(label)}" width="200" height="200"
                   style="display:block;width:200px;height:200px;border:0;background-color:#ffffff" />
            </td>
          </tr>
        </table>
        <p style="margin:10px 0 0;font-family:${FONT};font-size:11px;font-weight:800;letter-spacing:0.16em;color:${INK}">SCAN AT ENTRY</p>
      </td>
    </tr>
  </table>`;
}

/** A tinted callout. `tone` is 'info', 'warning' or 'danger'. */
function note(tone, html) {
  const bg = tone === 'warning' ? WARN_BG : tone === 'danger' ? DANGER_BG : SUNKEN;
  const line = tone === 'warning' ? WARN_LINE : tone === 'danger' ? DANGER_LINE : BRAND;
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin:0 0 18px">
    <tr>
      <td style="padding:13px 16px;background-color:${bg};border-left:3px solid ${line};border-radius:8px;font-family:${FONT};font-size:13px;line-height:1.6;color:${INK}">
        ${html}
      </td>
    </tr>
  </table>`;
}

/** Somebody's own words, shown back to them — a rejection reason, a note. */
function quote(text) {
  return note('info', `<em style="color:${MUTED}">${escapeHtml(text)}</em>`);
}

/** A label/value summary — an order total, an invoice, a payout. */
function facts(pairs) {
  const rows = pairs
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([label, value], i) => `
      <tr>
        <td style="padding:9px 0;${i ? `border-top:1px solid ${LINE};` : ''}font-family:${FONT};font-size:13px;color:${MUTED}">${escapeHtml(label)}</td>
        <td align="right" style="padding:9px 0;${i ? `border-top:1px solid ${LINE};` : ''}font-family:${FONT};font-size:13px;font-weight:600;color:${INK}">${escapeHtml(value)}</td>
      </tr>`).join('');

  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
         style="width:100%;margin:0 0 20px;background-color:${SURFACE};border:1px solid ${LINE};border-radius:12px">
    <tr><td style="padding:4px 18px;background-color:${SURFACE}">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rows}</table>
    </td></tr>
  </table>`;
}

module.exports = {
  BRAND, BRAND_DARK, BRAND_TINT, HIGHLIGHT, HIGHLIGHT_WASH, PAPER, STUB, INK, MUTED, SUBTLE, LINE, SURFACE, SUNKEN, FONT, MONO,
  escapeHtml, siteUrl, apiUrl, money, whenText, monthText, seatLabel,
  layout, p, button, eventCard, ticketCard, note, quote, facts,
};
