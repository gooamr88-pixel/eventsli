import Image from 'next/image';
import NavIcon from '../../components/shell/NavIcon';
import { safeExternalUrl } from '../../utils/safeUrl';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The EVENT's own sponsors — the ones its organizer added, never Eventsli's
 * platform partners (those are on the homepage only) — one section, in tiers (owner: "the sponsors of
 * each event are very terrible", 2026-11-15).
 *
 * It replaces two things that did not look like one product: a "Presented by"
 * card under the header and bare logos floating in the Organizer tab, sized by
 * whatever file was uploaded. Now:
 *
 *   · the HEADLINE sponsor gets a featured card — its logo large on white, a
 *     yellow badge, its name and a "Visit website" button;
 *   · every other tier (Gold, Silver, Bronze, Partners) gets a marker in its
 *     own metal and a grid of IDENTICAL white tiles, larger for a higher tier,
 *     so the logos line up however they were drawn.
 *
 * A LOGO IS A LINK ONLY IF THERE IS ONE, and every link is `nofollow`: these
 * are addresses an organizer typed, and this page should not vouch for them.
 * A sponsor with no logo is its name, set in the tile, never an empty box.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const TIERS = [
  { level: 'gold', label: 'Gold sponsors', one: 'Gold sponsor' },
  { level: 'silver', label: 'Silver sponsors', one: 'Silver sponsor' },
  { level: 'bronze', label: 'Bronze sponsors', one: 'Bronze sponsor' },
  { level: 'partner', label: 'Partners', one: 'Partner' },
];

export default function EventSponsorsSection({ sponsors = [], sponsorUrl = null }) {
  // `sponsorUrl`: the organizer's public sponsor page is open (2026-11-20).
  if (sponsors.length === 0 && !sponsorUrl) return null;
  const headline = sponsors.filter((s) => s.level === 'headline');
  const tiers = TIERS
    .map((t) => ({ ...t, list: sponsors.filter((s) => s.level === t.level) }))
    .filter((t) => t.list.length > 0);
  // Anything with a level this page does not know still shows, as a partner.
  const known = new Set(['headline', ...TIERS.map((t) => t.level)]);
  const other = sponsors.filter((s) => !known.has(s.level));
  if (other.length) {
    const partners = tiers.find((t) => t.level === 'partner');
    if (partners) partners.list.push(...other);
    else tiers.push({ ...TIERS[3], list: other });
  }

  return (
    <section id="event-sponsors" className="es-evsp" aria-labelledby="event-sponsors-title">
      <div className="es-evsp__head">
        <h2 id="event-sponsors-title" className="es-evsp__title">
          Event <span className="es-lp-accent">sponsors</span>
        </h2>
        <p className="es-evsp__lede">{sponsors.length ? 'The brands making this event happen, chosen by its organizer.' : 'This event is looking for sponsors.'}</p>
        {sponsorUrl && (
          <a href={sponsorUrl} className="es-btn es-btn--secondary es-evsp__become">
            <NavIcon name="handshake" size={18} />Become a sponsor
          </a>
        )}
      </div>

      {headline.map((s) => <Featured key={s.id} sponsor={s} />)}

      {tiers.map((tier) => (
        <div key={tier.level} className="es-evsp__tier" data-level={tier.level}>
          <h3 className="es-evsp__tier-name">
            <span aria-hidden className="es-evsp__medal" />
            {tier.list.length > 1 ? tier.label : tier.one}
          </h3>
          <ul className="es-evsp__grid">
            {tier.list.map((s) => (
              <li key={s.id}><Tile sponsor={s} /></li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function Featured({ sponsor }) {
  const link = safeExternalUrl(sponsor.linkUrl);
  return (
    <article className="es-evsp__featured">
      <div className="es-evsp__featured-logo">
        {sponsor.logoUrl
          ? <Image src={sponsor.logoUrl} alt={sponsor.name} width={360} height={160} className="es-evsp__img" />
          : <span className="es-evsp__name-only">{sponsor.name}</span>}
      </div>
      <div className="es-evsp__featured-text">
        <span className="es-evsp__badge"><NavIcon name="star" size={14} />Headline sponsor</span>
        <p className="es-evsp__featured-name fx-break">Presented by {sponsor.name}</p>
        {link && (
          <a href={link} target="_blank" rel="noreferrer noopener nofollow" className="es-evsp__visit">
            Visit website
            <NavIcon name="external" size={16} />
            <span className="sr-only"> — {sponsor.name}, opens in a new tab</span>
          </a>
        )}
      </div>
    </article>
  );
}

function Tile({ sponsor }) {
  const link = safeExternalUrl(sponsor.linkUrl);
  const body = sponsor.logoUrl
    ? <Image src={sponsor.logoUrl} alt={sponsor.name} width={240} height={120} className="es-evsp__img" />
    : <span className="es-evsp__name-only">{sponsor.name}</span>;
  if (!link) return <span className="es-evsp__tile">{body}</span>;
  return (
    <a
      href={link}
      target="_blank"
      rel="noreferrer noopener nofollow"
      className="es-evsp__tile es-evsp__tile--link"
      aria-label={`${sponsor.name} — opens their website in a new tab`}
    >
      {body}
    </a>
  );
}
