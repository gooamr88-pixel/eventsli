'use client';

import { useId, useRef } from 'react';
import NavIcon from '../../../../components/shell/NavIcon';
import { useToast } from '../../../../components/ui/Toast';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The side column of Share & QR: the link on its own with ways to send it, and
 * where a printed code earns its place.
 *
 * THE SHARE BUTTONS ARE THE NETWORKS' OWN SHARE ADDRESSES — wa.me, Facebook's
 * sharer and a mailto — opened in a new tab with the server-built URL. Nothing
 * is posted on the organizer's behalf and no account is connected; the
 * organizer finishes the share themselves, on the network, where it belongs.
 * Text labels rather than the networks' logos.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function ShareLinkCard({ url, title }) {
  const toast = useToast();
  const inputId = useId();
  const input = useRef(null);
  const text = `${title} — ${url}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied.');
    } catch {
      input.current?.select();
      toast.show('Press Ctrl+C (or ⌘C) to copy the selected link.', { tone: 'success' });
    }
  }

  const targets = [
    { key: 'whatsapp', label: 'WhatsApp', icon: 'chat', href: `https://wa.me/?text=${encodeURIComponent(text)}` },
    { key: 'facebook', label: 'Facebook', icon: 'users', href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}` },
    { key: 'email', label: 'Email', icon: 'mail', href: `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}` },
  ];

  return (
    <section className="es-dcard" aria-labelledby="share-link">
      <div className="es-ovcard__head">
        <span className="es-ovcard__glyph" aria-hidden="true"><NavIcon name="link" size={24} /></span>
        <div className="fx-min0">
          <h2 id="share-link" className="es-dcard__title">Share link</h2>
          <p className="es-ovcard__desc">A direct link to your public event page.</p>
        </div>
      </div>
      <div className="es-qrlink">
        <label htmlFor={inputId} className="sr-only">Event page link</label>
        <input ref={input} id={inputId} readOnly value={url} onFocus={(e) => e.target.select()} />
        <button type="button" className="es-qrlink__copy" onClick={copy}><NavIcon name="copy" size={16} />Copy</button>
      </div>
      <div className="fx-stack fx-stack--sm gap-2">
        <p className="text-sm font-semibold text-ink">Share on</p>
        <div className="es-shareon">
          {targets.map((t) => (
            <a key={t.key} href={t.href} target="_blank" rel="noopener noreferrer" className="es-shareon__btn" data-net={t.key}>
              <NavIcon name={t.icon} size={20} />
              {t.label}<span className="sr-only"> (opens in a new tab)</span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

const TIPS = [
  { key: 'posters', icon: 'image', title: 'Posters', text: 'At the venue entrance and the registration area.' },
  { key: 'tables', icon: 'layers', title: 'Tables', text: 'A small QR stand on each table, for anyone who arrives without a ticket.' },
  { key: 'signage', icon: 'eye', title: 'Signage', text: 'On event screens and venue signs, big enough to scan from a few steps away.' },
];

export function PrintTips() {
  return (
    <section className="es-dcard" aria-labelledby="share-tips">
      <div className="es-ovcard__head">
        <span className="es-ovcard__glyph" aria-hidden="true"><NavIcon name="printer" size={24} /></span>
        <div className="fx-min0">
          <h2 id="share-tips" className="es-dcard__title">Print &amp; placement tips</h2>
          <p className="es-ovcard__desc">Get the most from your QR code.</p>
        </div>
      </div>
      <ul className="es-tips">
        {TIPS.map((t) => (
          <li key={t.key}>
            <span className="es-tips__icon" aria-hidden="true"><NavIcon name={t.icon} size={20} /></span>
            <span className="fx-min0">
              <b>{t.title}</b>
              <small>{t.text}</small>
            </span>
          </li>
        ))}
      </ul>
      <p className="es-tips__note">
        <NavIcon name="info" size={18} />
        Use the PNG for printing up to poster size, and the SVG for anything larger, like banners.
      </p>
    </section>
  );
}
