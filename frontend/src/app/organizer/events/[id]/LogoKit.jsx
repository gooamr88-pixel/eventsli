import NavIcon from '../../../components/shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "PUT OUR LOGO ON YOUR COVER" — and the files to do it (owner, 2026-11-17).
 *
 * Every event's cover must carry the Eventsli logo, designed into the image by
 * the organizer, so the poster says where it is sold wherever it travels:
 * Instagram, WhatsApp, print. This states the requirement where the cover is
 * uploaded, gives the placement rules from the brand guidelines
 * (docs/brand/README.md), and offers the logo files.
 *
 * The files are the official kit (docs/brand), copied to /public/brand by
 * scripts/brandDownloads.js — never redrawn — plus the white logo without the
 * tagline, which is the one most covers need. Plain links with `download`, so
 * they work without JavaScript and from any device.
 *
 * Not enforced by the upload: nothing can reliably read a logo out of a
 * picture, and refusing a cover over a guess would block honest organizers.
 * It is a stated rule, as the terms are.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const FILES = [
  {
    key: 'white',
    title: 'White logo',
    use: 'For photos and dark covers — the one most covers need.',
    tone: 'dark',
    preview: '/brand/eventsli-logo-white-no-tagline.svg',
    png: '/brand/eventsli-logo-white-no-tagline.png',
    svg: '/brand/eventsli-logo-white-no-tagline.svg',
  },
  {
    key: 'colour',
    title: 'Full-colour logo',
    use: 'For white and light covers.',
    tone: 'light',
    preview: '/brand/eventsli-logo-full-colour-no-tagline.svg',
    png: '/brand/eventsli-logo-full-colour-no-tagline.png',
    svg: '/brand/eventsli-logo-full-colour-no-tagline.svg',
  },
  {
    key: 'mark',
    title: 'E mark',
    use: 'For small corners, where the full logo would be too small to read.',
    tone: 'light',
    preview: '/brand/eventsli-mark.svg',
    png: '/brand/eventsli-mark.png',
    svg: '/brand/eventsli-mark.svg',
  },
  {
    key: 'black',
    title: 'Black logo',
    use: 'For one-colour printing only.',
    tone: 'light',
    preview: '/brand/eventsli-logo-black.svg',
    png: '/brand/eventsli-logo-black.png',
    svg: '/brand/eventsli-logo-black.svg',
  },
];

const RULES = [
  'Place it in a corner, at least a sixth of the cover’s width, so it can be read on a phone.',
  'Leave clear space around it as wide as the yellow ticket — no text or faces inside it.',
  'White logo on photos and dark designs, full-colour on light ones. On a busy photo, put it on a solid patch.',
  'Don’t stretch, rotate, recolour it or add shadows or outlines.',
];

export default function LogoKit() {
  return (
    <section className="es-logokit" aria-labelledby="logokit-title">
      <div className="es-logokit__head">
        <span className="es-logokit__icon" aria-hidden="true"><NavIcon name="alert" size={20} /></span>
        <div className="fx-min0">
          <h3 id="logokit-title" className="es-logokit__title">Your cover must include the Eventsli logo</h3>
          <p className="es-logokit__lede">
            Design your cover with our logo on it before you upload it. It is required for every event on
            Eventsli, so your poster shows where tickets are sold wherever it is shared.
          </p>
        </div>
      </div>

      <ul className="es-logokit__rules">
        {RULES.map((r) => (
          <li key={r}><span aria-hidden="true"><NavIcon name="tick" size={14} /></span>{r}</li>
        ))}
      </ul>

      <ul className="es-logokit__files" aria-label="Eventsli logo files">
        {FILES.map((f) => (
          <li key={f.key} className="es-logokit__file">
            <span className={`es-logokit__preview es-logokit__preview--${f.tone}`}>
              {/* Our own static file; next/image adds nothing to an SVG. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.preview} alt="" loading="lazy" />
            </span>
            <span className="es-logokit__name">{f.title}</span>
            <span className="es-logokit__use">{f.use}</span>
            <span className="es-logokit__links">
              <a href={f.png} download className="es-btn es-btn--secondary es-btn--sm">
                <NavIcon name="download" size={16} />PNG<span className="sr-only"> — {f.title}</span>
              </a>
              {/* The secondary format, as a compact link so both fit one line. */}
              <a href={f.svg} download className="es-logokit__svg">
                SVG<span className="sr-only"> — {f.title}</span>
              </a>
            </span>
          </li>
        ))}
      </ul>

      <div className="es-logokit__foot">
        <a href="/brand/eventsli-logo-kit.zip" download className="es-btn es-btn--primary es-btn--sm">
          <NavIcon name="download" size={16} />Download all (.zip)
        </a>
        <span className="text-xs text-subtle">
          PNG for Canva, Photoshop and phone apps; SVG for designers and print. Transparent backgrounds.
        </span>
      </div>
    </section>
  );
}
