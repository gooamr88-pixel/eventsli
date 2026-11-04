'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { get } from '../../../../utils/apiClient';
import { useToast } from '../../../../components/ui/Toast';
import NavIcon from '../../../../components/shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * One shareable link: its QR code, the link itself, copy and download.
 *
 * The image is fetched with the organizer's session and shown from a blob URL,
 * rather than as an <img src> pointing at the API. The endpoint is behind auth,
 * and an <img> across origins in development does not carry the cookie reliably;
 * a blob works the same everywhere and the CSP already allows `blob:` images.
 *
 * The download asks for the LARGE rendering (1200px) — the on-screen one is
 * sized for a screen, and a poster printed from it would be soft.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function QrCard({ title, subtitle, url, qrPath, filename, featured = false, meta = null }) {
  const toast = useToast();
  const inputId = useId();
  const inputRef = useRef(null);
  const [image, setImage] = useState({ src: null, failed: false });
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;
    (async () => {
      try {
        const blob = await get(qrPath, { cache: 'no-store' });
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setImage({ src: objectUrl, failed: false });
      } catch {
        if (!cancelled) setImage({ src: null, failed: true });
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [qrPath]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied.');
    } catch {
      // No clipboard permission (an http origin, an old browser): select the
      // text so one keystroke finishes the job.
      inputRef.current?.select();
      toast.show('Press Ctrl+C (or ⌘C) to copy the selected link.', { tone: 'success' });
    }
  }

  // `kind` is 'png' (the 1200px rendering) or 'svg' (the vector, from
  // qr.svg — the same server-built URL inside, for banners and large prints).
  async function download(kind = 'png') {
    setDownloading(kind);
    try {
      const joiner = qrPath.includes('?') ? '&' : '?';
      const path = kind === 'svg'
        ? `${qrPath.replace('/qr.png', '/qr.svg')}${joiner}download=1`
        : `${qrPath}${joiner}size=lg&download=1`;
      const blob = await get(path, { cache: 'no-store' });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = kind === 'svg' ? filename.replace(/\.png$/, '.svg') : filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch {
      toast.error('The QR code could not be downloaded. Try again in a moment.');
    } finally {
      setDownloading(false);
    }
  }

  /**
   * PRINT opens the large rendering alone in a new window and prints it. The
   * window is written from here, with no script of its own — the page's CSP
   * would refuse one — and the print call waits for the image to load.
   */
  async function print() {
    const win = window.open('', '_blank', 'width=720,height=860');
    if (!win) { toast.error('Allow pop-ups for Eventsli to print the QR code.'); return; }
    try {
      const joiner = qrPath.includes('?') ? '&' : '?';
      const blob = await get(`${qrPath}${joiner}size=lg`, { cache: 'no-store' });
      const href = URL.createObjectURL(blob);
      win.document.title = `QR code — ${title}`;
      win.document.body.style.cssText = 'margin:0;display:grid;place-items:center;min-height:100vh;font:16px system-ui,sans-serif';
      const img = win.document.createElement('img');
      img.alt = `QR code for ${title}`;
      img.style.cssText = 'width:min(90vw,14cm);height:auto';
      const caption = win.document.createElement('p');
      caption.textContent = title;
      img.onload = () => { win.focus(); win.print(); };
      img.src = href;
      win.document.body.append(img, caption);
    } catch {
      win.close();
      toast.error('The QR code could not be prepared for printing.');
    }
  }

  const qr = image.src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={image.src} alt={`QR code for ${title}`} className="es-qr" width="176" height="176" />
  ) : (
    <div className="es-qr grid place-items-center text-center text-xs text-subtle" role="img" aria-label={image.failed ? 'QR code unavailable' : 'Loading QR code'}>
      {image.failed ? 'Could not load' : <span className="es-skeleton size-full" />}
    </div>
  );

  const linkBox = (
    <div className="es-qrlink">
      <NavIcon name="link" size={16} />
      <label htmlFor={inputId} className="sr-only">{`Link for ${title}`}</label>
      <input ref={inputRef} id={inputId} readOnly value={url} onFocus={(e) => e.target.select()} />
      <button type="button" className="es-qrlink__copy" onClick={copy}>
        <NavIcon name="copy" size={16} />Copy
      </button>
    </div>
  );

  // THE EVENT PAGE'S CODE: the card with the green band, the facts, and every
  // way to get the code out — PNG for print, SVG for anything larger, Print.
  if (featured) {
    return (
      <article className="es-dcard es-qrhero" aria-labelledby={`${inputId}-title`}>
        <p className="es-qrhero__band"><NavIcon name="qr" size={22} />Event page QR code</p>
        <div className="es-qrhero__body">
          <div className="es-qrhero__code">{qr}</div>
          <div className="fx-stack fx-stack--sm fx-min0">
            <h2 id={`${inputId}-title`} className="es-qrhero__title fx-break">{title}</h2>
            {meta && <p className="es-ovhero__meta es-qrhero__meta">{meta}</p>}
            {linkBox}
            <div className="es-qrhero__actions">
              <button type="button" className="es-btn es-btn--primary es-btn--sm" onClick={() => download('png')} disabled={Boolean(downloading)}>
                <NavIcon name="download" size={16} />{downloading === 'png' ? 'Preparing…' : 'Download PNG'}
              </button>
              <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={() => download('svg')} disabled={Boolean(downloading)}>
                <NavIcon name="download" size={16} />{downloading === 'svg' ? 'Preparing…' : 'Download SVG'}
              </button>
              <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={print}>
                <NavIcon name="printer" size={16} />Print QR
              </button>
            </div>
            <p className="es-qrhero__note"><NavIcon name="info" size={16} />{subtitle}</p>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="es-dcard es-qrtile">
      <div className="es-qrtile__top">
        <div className="es-qrtile__code">{qr}</div>
        <div className="fx-min0">
          <h3 className="fx-break font-semibold text-ink">{title}</h3>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {linkBox}
      <div className="fx-row gap-2">
        <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={() => download('png')} disabled={Boolean(downloading)} aria-busy={Boolean(downloading) || undefined}>
          <NavIcon name="download" size={16} />{downloading ? 'Preparing…' : 'PNG'}
        </button>
        <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={() => download('svg')} disabled={Boolean(downloading)}>
          <NavIcon name="download" size={16} />SVG
        </button>
        <a href={url} target="_blank" rel="noreferrer" className="es-btn es-btn--ghost es-btn--sm">Open</a>
      </div>
    </article>
  );
}
