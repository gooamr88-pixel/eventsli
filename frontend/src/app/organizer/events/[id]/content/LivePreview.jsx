import Image from 'next/image';
import NavIcon from '../../../../components/shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The event page in miniature, beside the editors that build it.
 *
 * It draws what is SAVED: the event as the layout last loaded it, and the
 * gallery, schedule and sponsors lists the editors share with it (the page
 * loads each once and hands the same object to both). So it moves the moment
 * a save lands, and an unsaved draft in an editor is not shown as if it were
 * live — the bar at the foot of this screen is what makes it so.
 *
 * A sketch, not a second renderer: sizes and order follow `/e/[slug]`, but it
 * is deliberately not that page's components, which are server-rendered and
 * fetch their own data.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function timeOf(iso, timeZone) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  } catch { return ''; }
}

export default function LivePreview({ event, media, schedule, sponsors, publicUrl }) {
  const highlights = (event.highlights || []).slice(0, 4);
  const photos = (media || []).filter((m) => m.kind === 'image').slice(0, 3);
  const agenda = (schedule || []).slice(0, 3);
  const partners = (sponsors || []).slice(0, 3);

  return (
    <section className="es-dcard es-pbprev" aria-labelledby="pb-preview">
      <div className="es-dcard__head">
        <div className="es-ovcard__head">
          <span className="es-ovcard__glyph" aria-hidden="true"><NavIcon name="eye" size={22} /></span>
          <div className="fx-min0">
            <h2 id="pb-preview" className="es-dcard__title">Live page preview</h2>
            <p className="es-ovcard__desc">Your event page, as saved.</p>
          </div>
        </div>
        {publicUrl && (
          <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="es-topbar__icon" title="Open the public page">
            <NavIcon name="external" size={18} /><span className="sr-only">Open the public page (new tab)</span>
          </a>
        )}
      </div>

      <div className="es-pbprev__page" aria-hidden="true">
        <div className="es-pbprev__cover">
          {event.cover?.url
            ? <Image src={event.cover.url} alt="" fill sizes="360px" className="object-cover" />
            : <span className="es-pbprev__none"><NavIcon name="image" size={28} /></span>}
          <span className="es-pbprev__logo">
            {event.logo?.url
              ? <Image src={event.logo.url} alt="" width={64} height={64} className="h-full w-full object-contain" />
              : <NavIcon name="image" size={22} />}
          </span>
        </div>
        <p className="es-pbprev__title">{event.title}</p>

        {highlights.length > 0 && (
          <ul className="es-pbprev__facts">
            {highlights.map((h, i) => (
              <li key={`${h}-${i}`}><NavIcon name="sparkle" size={18} /><span>{h}</span></li>
            ))}
          </ul>
        )}

        {photos.length > 0 && (
          <div className="es-pbprev__block">
            <p className="es-pbprev__h"><NavIcon name="image" size={18} />Gallery</p>
            <div className="es-pbprev__thumbs">
              {photos.map((m) => (
                <span key={m.id} className="es-pbprev__thumb"><Image src={m.url} alt="" fill sizes="120px" className="object-cover" /></span>
              ))}
            </div>
          </div>
        )}

        {agenda.length > 0 && (
          <div className="es-pbprev__block">
            <p className="es-pbprev__h"><NavIcon name="calendar" size={18} />Schedule &amp; Lineup</p>
            <ul className="es-pbprev__agenda">
              {agenda.map((s) => (
                <li key={s.id}><b>{timeOf(s.startsAt, event.timezone) || '·'}</b><span>{s.title}</span></li>
              ))}
            </ul>
          </div>
        )}

        {partners.length > 0 && (
          <div className="es-pbprev__block">
            <p className="es-pbprev__h"><NavIcon name="users" size={18} />Sponsors &amp; Partners</p>
            <div className="es-pbprev__logos">
              {partners.map((p) => (
                <span key={p.id} className="es-pbprev__sponsor">
                  {p.logoUrl ? <Image src={p.logoUrl} alt="" width={80} height={40} className="h-full w-auto object-contain" /> : p.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {!highlights.length && !photos.length && !agenda.length && !partners.length && (
          <p className="es-pbprev__empty">Add highlights, photos, a schedule or sponsors and they appear here.</p>
        )}
      </div>
    </section>
  );
}
