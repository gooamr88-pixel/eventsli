/**
 * Dates and money, as a buyer reads them.
 *
 * AN EVENT'S TIME IS SHOWN IN THE EVENT'S ZONE. A Cairo show at 8 PM is at
 * 8 PM to somebody browsing from Toronto: the ticket, the door and the event
 * page all say 8 PM, and the one screen that disagreed would be the one they
 * planned around. Every helper here takes the event's `timezone`.
 *
 * MONEY IS AN INTEGER IN THE CURRENCY'S MINOR UNIT, as the API sends it:
 * cents, piastres, yen (no decimals), fils (three). Dividing by 100 would
 * print a yen price a hundred times too small and a dinar price ten times too
 * large; the number of decimals comes from Intl, per currency.
 */

function safe(fn: () => string, fallback = ''): string {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

const zone = (timeZone?: string | null) => (timeZone ? { timeZone } : {});

/** "Nov 20, 2026" */
export function eventDate(iso: string | null | undefined, timeZone?: string | null): string {
  if (!iso) return '';
  return safe(() => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', ...zone(timeZone) }));
}

/** "8:00 PM" */
export function eventTime(iso: string | null | undefined, timeZone?: string | null): string {
  if (!iso) return '';
  return safe(() => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...zone(timeZone) }));
}

/** "Nov 20, 2026 • 8:00 PM" */
export function eventWhen(iso: string | null | undefined, timeZone?: string | null): string {
  if (!iso) return '';
  return `${eventDate(iso, timeZone)} • ${eventTime(iso, timeZone)}`;
}

/** "Sat, Nov 20" — the short form on cards. */
export function eventDay(iso: string | null | undefined, timeZone?: string | null): string {
  if (!iso) return '';
  return safe(() => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...zone(timeZone) }));
}

/** Month and day apart, for the date block on a ticket: { month: 'NOV', day: '20' }. */
export function dateBlock(iso: string | null | undefined, timeZone?: string | null) {
  if (!iso) return { month: '', day: '' };
  return {
    month: safe(() => new Date(iso).toLocaleDateString('en-US', { month: 'short', ...zone(timeZone) })).toUpperCase(),
    day: safe(() => new Date(iso).toLocaleDateString('en-US', { day: 'numeric', ...zone(timeZone) })),
  };
}

/** "2h ago", "3d ago" — for the notification list, on the phone's clock. */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return safe(() => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
}

/** How many decimals a currency's minor unit has: USD 2, JPY 0, KWD 3. */
export function minorDigits(currency: string): number {
  try {
    const digits = new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
    return typeof digits === 'number' ? digits : 2;
  } catch {
    return 2; // an unknown code: the common case, rather than a crash
  }
}

/**
 * "EGP 1,600" / "$40.50" / "¥3,000". Whole amounts drop their decimals —
 * "EGP 1,600.00" on a ticket button is noise — but a real fraction keeps them.
 */
export function money(minor: number | null | undefined, currency: string | null | undefined): string {
  if (minor === null || minor === undefined || !currency) return '';
  const digits = minorDigits(currency);
  const amount = minor / 10 ** digits;
  const whole = Number.isInteger(amount);
  const fraction = { minimumFractionDigits: whole ? 0 : digits, maximumFractionDigits: digits };
  return safe(
    () => {
      const symbol = new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'narrowSymbol', ...fraction });
      // A symbol made of letters ("E£" for EGP) reads as a typo; the mockup
      // writes "EGP 1,600". A plain sign — $, €, £, ¥ — stays a sign.
      const sign = symbol.formatToParts(amount).find((p) => p.type === 'currency')?.value ?? '';
      if (/[A-Za-z]/.test(sign)) return `${currency.toUpperCase()} ${new Intl.NumberFormat('en-US', fraction).format(amount)}`;
      return symbol.format(amount);
    },
    `${currency} ${amount}`,
  );
}

/** "Free" for zero, the amount otherwise. */
export function price(minor: number | null | undefined, currency: string | null | undefined): string {
  if (minor === 0) return 'Free';
  return money(minor, currency);
}

/** "12:04" left on a hold. */
export function countdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * When an event runs, as two lines: the day(s), then the hours — "Nov 20,
 * 2026" / "8:00 PM – 11:00 PM". Over several days the first line becomes the
 * span and the second names each end's day, so a festival does not read as
 * "12:18 AM – 2:18 AM" (the check-in app's eventSpan, 2026-11-20).
 */
export function eventSpanText(
  startsAt: string | null | undefined,
  endsAt: string | null | undefined,
  timeZone?: string | null,
): { date: string; time: string } {
  const start = eventDate(startsAt, timeZone);
  const end = endsAt ? eventDate(endsAt, timeZone) : '';
  if (!startsAt || !endsAt || !end || start === end) {
    return { date: start, time: endsAt ? `${eventTime(startsAt, timeZone)} – ${eventTime(endsAt, timeZone)}` : eventTime(startsAt, timeZone) };
  }
  const part = (iso: string, opts: Intl.DateTimeFormatOptions) => safe(() => new Date(iso).toLocaleDateString('en-US', { ...opts, ...zone(timeZone) }));
  const short = (iso: string) => `${part(iso, { month: 'short', day: 'numeric' })}, ${eventTime(iso, timeZone)}`;
  return { date: `${part(startsAt, { month: 'short', day: 'numeric' })} – ${end}`, time: `${short(startsAt)} – ${short(endsAt)}` };
}

/**
 * "EG" → "Egypt", for the Settings row the mockup writes as "Cairo, Egypt".
 * Intl.DisplayNames is missing on some engines; the code is then shown as is.
 */
export function countryName(code: string | null | undefined): string {
  if (!code) return '';
  try {
    const Names = (Intl as unknown as { DisplayNames?: new (l: string[], o: { type: 'region' }) => { of: (c: string) => string | undefined } }).DisplayNames;
    return (Names ? new Names(['en'], { type: 'region' }).of(code.toUpperCase()) : null) ?? code;
  } catch {
    return code;
  }
}

/**
 * The time of day, unless it is exactly midnight where the event is — which on
 * production means "no time was entered" (organizers set the date only; every
 * listed event read "12:00 AM", 2026-11-28). Lists leave it out rather than
 * print a door time nobody chose.
 */
export function listedTime(iso: string | null | undefined, timeZone?: string | null): string {
  const t = eventTime(iso, timeZone);
  return t === '12:00 AM' ? '' : t;
}
