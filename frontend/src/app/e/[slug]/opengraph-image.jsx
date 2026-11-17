import { ImageResponse } from 'next/og';
import { serverFetch } from '../../utils/apiClient';
import { siteOrigin } from '../../lib/eventSeo';
import { isDateOnly, formatDateOnly } from '../../lib/dateOnly';
import { isComingSoon, comingSoonLabel } from '../../lib/comingSoon';
import { MARK_VIEWBOX, MARK_FRAME, MARK_INITIAL } from '../../components/brand/markPath';
import {
  WORDMARK_VIEWBOX, WORDMARK_EVENTS, WORDMARK_LI, WORDMARK_SPARK,
} from '../../components/brand/wordmarkPath';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SHARE CARD FOR AN EVENT LINK, branded (owner, 2026-11-17).
 *
 * What WhatsApp, Facebook, X, iMessage and Slack show when someone shares
 * /e/<slug>. It used to be the raw cover, so a shared poster carried nothing
 * that said Eventsli. Now it is a designed 1200×630 card: the poster shown
 * WHOLE on the right (posters are usually portrait, and cropping one to a wide
 * card cuts off its date and line-up), the title, the date and the city on the
 * left, and the Eventsli logo — on the platform's near-black, with the brand's
 * yellow and coral.
 *
 * File-based metadata wins over the page's `generateMetadata` images (Next's
 * rule), so this replaces the cover there without touching the page; the
 * page's own `openGraph.images` stays as the fallback it always was.
 *
 * NOTHING HERE CAN BREAK A SHARE. The poster is fetched first and used only if
 * it is a JPEG or PNG under 6MB (the image renderer reads no WebP); otherwise
 * the card draws the E card in its place. The brand typeface is fetched once
 * per server; if that fails, the renderer's own sans is used. An event that
 * is not public renders the plain Eventsli card rather than an error.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const alt = 'An event on Eventsli';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
// The event page caches for a minute; a share card can live a little longer.
export const revalidate = 300;

const INK = '#111018';
const SUN = '#ffcc00';
const CORAL = '#ff414b';

/** Urbanist (the logo's face), as TTF — the renderer reads no WOFF2. Once per server. */
let fontsPromise = null;
function brandFonts() {
  if (!fontsPromise) {
    fontsPromise = (async () => {
      const load = async (weight) => {
        // Without a browser user agent, Google Fonts answers with TrueType.
        const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Urbanist:wght@${weight}`, {
          signal: AbortSignal.timeout(4000),
        })).text();
        const url = /src:\s*url\((https:[^)]+)\)\s*format\('(?:truetype|opentype)'\)/.exec(css)?.[1];
        if (!url) throw new Error('no TrueType face');
        const data = await (await fetch(url, { signal: AbortSignal.timeout(4000) })).arrayBuffer();
        return { name: 'Urbanist', data, weight, style: 'normal' };
      };
      return Promise.all([load(600), load(800)]);
    })().catch(() => {
      fontsPromise = null;   // try again on the next card
      return [];
    });
  }
  return fontsPromise;
}

/** The poster as a data URL, or null when it cannot be drawn safely. */
async function posterData(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const type = String(res.headers.get('content-type') || '').split(';')[0].trim();
    if (!['image/jpeg', 'image/png'].includes(type)) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > 6 * 1024 * 1024) return null;
    return `data:${type};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

async function loadEvent(slug) {
  try {
    return await serverFetch(`/public/events/${encodeURIComponent(slug)}`, { tags: [`event:${slug}`], revalidate: 300 });
  } catch {
    return null;
  }
}

/** The date line, as the event page says it: a teaser's month, a listing's days, or a time. */
function whenText(event) {
  if (isComingSoon(event)) return comingSoonLabel(event);
  if (isDateOnly(event)) return formatDateOnly(event);
  try {
    const at = new Date(event.startsAt);
    const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: event.timezone }).format(at);
    const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: event.timezone }).format(at);
    return `${day} · ${time}`;
  } catch {
    return '';
  }
}

const clip = (text, max) => {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
};

function Mark({ height }) {
  const [, , w, h] = MARK_VIEWBOX.split(' ').map(Number);
  return (
    <svg viewBox={MARK_VIEWBOX} width={Math.round((w / h) * height)} height={height}>
      <path d={MARK_FRAME} fill={SUN} />
      <path d={MARK_INITIAL} fill={INK} />
    </svg>
  );
}

function Word({ height, ink = '#ffffff' }) {
  const [, , w, h] = WORDMARK_VIEWBOX.split(' ').map(Number);
  return (
    <svg viewBox={WORDMARK_VIEWBOX} width={Math.round((w / h) * height)} height={height}>
      <path d={WORDMARK_EVENTS} fill={ink} />
      <path d={WORDMARK_LI} fill={ink} />
      <path d={WORDMARK_SPARK} fill={SUN} />
    </svg>
  );
}

export default async function Image({ params }) {
  const { slug } = await params;
  const [event, fonts] = await Promise.all([loadEvent(slug), brandFonts()]);
  const poster = event ? await posterData(event.coverUrl) : null;
  const host = siteOrigin().replace(/^https?:\/\//, '');
  const family = fonts.length ? 'Urbanist' : undefined;

  const teaser = event && isComingSoon(event);
  const cta = !event ? `Discover events on ${host}`
    : teaser ? `Get notified on ${host}`
      : event.displayOnly ? `Details on ${host}` : `Get tickets on ${host}`;
  const when = event ? whenText(event) : '';
  const place = event ? [event.venue, event.city].filter(Boolean).join(', ') : '';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', padding: 56, gap: 48,
          backgroundColor: INK,
          backgroundImage: `radial-gradient(circle at 92% 8%, rgba(255,65,75,0.32), transparent 42%), radial-gradient(circle at 0% 100%, rgba(255,204,0,0.18), transparent 45%)`,
          fontFamily: family,
          color: '#ffffff',
        }}
      >
        {/* Left: the logo, the event, the call to action. */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Mark height={48} />
            <Word height={40} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {teaser && (
              <div style={{ display: 'flex' }}>
                <span style={{ padding: '8px 18px', borderRadius: 999, backgroundColor: CORAL, fontSize: 22, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase' }}>
                  Coming soon
                </span>
              </div>
            )}
            <div style={{ fontSize: event && event.title.length > 42 ? 54 : 64, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1.5 }}>
              {event ? clip(event.title, 80) : 'Find something to go to'}
            </div>
            {when && <div style={{ fontSize: 28, fontWeight: 600, color: SUN }}>{clip(when, 60)}</div>}
            {place && <div style={{ fontSize: 26, fontWeight: 600, color: 'rgba(255,255,255,0.78)' }}>{clip(place, 56)}</div>}
          </div>

          <div style={{ display: 'flex' }}>
            <span style={{ padding: '14px 26px', borderRadius: 999, backgroundColor: '#ffffff', color: INK, fontSize: 24, fontWeight: 800 }}>
              {cta}
            </span>
          </div>
        </div>

        {/* Right: the poster, whole, or the E card when there is none. */}
        <div
          style={{
            width: 420, height: 518, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 28, overflow: 'hidden', backgroundColor: '#1f1d29',
            border: '2px solid rgba(255,255,255,0.12)',
            boxShadow: '0 30px 60px rgba(0,0,0,0.45)',
          }}
        >
          {poster ? (
            // eslint-disable-next-line @next/next/no-img-element -- rendered to a PNG by ImageResponse
            <img src={poster} alt="" width={420} height={518} style={{ width: 420, height: 518, objectFit: 'contain' }} />
          ) : (
            <Mark height={180} />
          )}
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
