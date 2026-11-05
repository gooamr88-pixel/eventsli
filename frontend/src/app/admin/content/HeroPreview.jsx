'use client';

import { useState } from 'react';
import NavIcon from '../../components/shell/NavIcon';

/**
 * The hero as the homepage will draw it, from the UNSAVED draft — so a
 * headline can be tried at its real length before anyone presses Save.
 *
 * An approximation, not the homepage component: the real hero carries the
 * search bar, the badge and the script accent, and importing it here would
 * pull the storefront's data fetching into the console. What it does show is
 * what is usually being judged here — does the headline fit, does the copy
 * read over THIS picture, and does the phone crop work. Desktop / Mobile
 * swaps both the frame's shape and the image, because the mobile background
 * is a different file (see the hero's description in BlockForm).
 */
export default function HeroPreview({ draft }) {
  const [device, setDevice] = useState('desktop');
  const mobile = device === 'mobile';
  const image = mobile ? (draft.mobileImageUrl || draft.imageUrl) : draft.imageUrl;

  return (
    <section className="es-heroprev" aria-label="Live preview of the hero">
      <div className="es-heroprev__bar">
        <span className="es-heroprev__label"><NavIcon name="eye" size={18} />Live preview</span>
        <div className="es-heroprev__devices" role="group" aria-label="Preview size">
          {[['desktop', 'monitor', 'Desktop'], ['mobile', 'tablet', 'Mobile']].map(([key, icon, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={device === key}
              onClick={() => setDevice(key)}
              className="es-heroprev__device"
            >
              <NavIcon name={icon} size={16} />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className={`es-heroprev__frame${mobile ? ' es-heroprev__frame--mobile' : ''}`}>
        {image ? (
          /* eslint-disable-next-line @next/next/no-img-element -- a just-uploaded
             storage URL, as in ImageField; next/image would need its host listed. */
          <img src={image} alt="" className="es-heroprev__img" />
        ) : (
          <span className="es-heroprev__noimg">No background image yet</span>
        )}
        <div className="es-heroprev__copy">
          {draft.eyebrow && <p className="es-heroprev__eyebrow">{draft.eyebrow}</p>}
          <p className="es-heroprev__title">
            {draft.title}
            {draft.titleAccent && <> <span className="es-heroprev__accent">{draft.titleAccent}</span></>}
          </p>
          {draft.body && <p className="es-heroprev__body">{draft.body}</p>}
          <div className="es-heroprev__ctas">
            {draft.primaryCtaLabel && <span className="es-heroprev__cta">{draft.primaryCtaLabel}</span>}
            {draft.secondaryCtaLabel && <span className="es-heroprev__cta es-heroprev__cta--ghost">{draft.secondaryCtaLabel}</span>}
          </div>
        </div>
      </div>
    </section>
  );
}
