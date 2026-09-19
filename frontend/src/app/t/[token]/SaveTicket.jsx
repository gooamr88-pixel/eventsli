'use client';

import { useCallback, useState } from 'react';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * KEEPING THE TICKET — on the one page most people actually hold one on.
 *
 * WHAT WAS MISSING. `/account/tickets` has had "Save as PDF" and a full set of
 * print rules since it was built. `/t/[token]` — the link in the confirmation
 * email, which is the ONLY copy a guest buyer has, and guest checkout is a
 * first-class path in this product — had nothing at all. No save, no print, no
 * offline copy. A buyer without an account could reach the door with a dead
 * battery, a dead signal, or a mail app that had pruned the message, and there
 * was no step anywhere in the product that would have prevented it.
 *
 * NO PDF LIBRARY, for the reasons `TicketActions` gives: every browser already
 * has a print engine that paginates, honours `@page` and offers "Save as PDF"
 * in the same dialog, and shipping a few hundred kilobytes to every ticket
 * holder to produce a worse version of it would also be a second layout to keep
 * in step with this one.
 *
 * TWO FRAMES BEFORE `print()`, the same as the account page: `window.print()`
 * blocks the main thread while the dialog is open, so calling it in the same
 * tick as a state change opens the dialog over a layout React has not painted.
 * Here nothing changes on screen first, so this is belt and braces — but the
 * cost is two frames and the failure it prevents is a blank PDF.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function SaveTicket() {
  const [busy, setBusy] = useState(false);

  const save = useCallback(() => {
    setBusy(true);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try {
        window.print();
      } finally {
        // `print()` returns only once the dialog is dismissed, in every engine.
        setBusy(false);
      }
    }));
  }, []);

  // `es-ticket-print-hide`: a printed ticket carrying a "Save or print this
  // ticket" button is the button explaining itself to nobody.
  return (
    <div className="es-ticket-print-hide fx-stack fx-stack--sm">
      <button
        type="button"
        onClick={save}
        disabled={busy}
        className="es-btn es-btn--secondary es-btn--block"
      >
        {busy ? 'Opening…' : 'Save or print this ticket'}
      </button>
      <p className="text-center text-xs text-subtle">
        Choose &ldquo;Save as PDF&rdquo; to keep it on your phone. A saved copy still
        scans with no signal at the door.
      </p>
    </div>
  );
}

/**
 * The print rules for this page.
 *
 * Mounted with the page rather than living in globals.css, for the reason the
 * account page's copy gives: one of these rules hides the entire application,
 * and a rule that can do that must not be reachable from a page that is not
 * this one.
 *
 * No `!important` anywhere — the project's check refuses them, and an element
 * selector beside the class beats any single utility class.
 */
export function TicketPrintStyles() {
  return (
    <style>{`
      @media print {
        @page { margin: 12mm; }

        /* The app around the ticket — header, footer — at whatever depth it
           sits. Visibility, not display: it inherits and a descendant can
           override it, so this does not depend on the ticket being a direct
           child of body. The account page's copy of these rules made that
           assumption, was wrong about it, and printed a blank sheet. */
        body * { visibility: hidden; }
        .es-ticket-page, .es-ticket-page * { visibility: visible; }
        .es-ticket-page {
          position: absolute;
          inset-inline-start: 0;
          top: 0;
          width: 100%;
        }

        .es-ticket-page nav,
        .es-ticket-print-hide { display: none; }

        /* A QR and the words beside it. Split across a page break it is a code
           nobody can scan. */
        .es-ticket-stub { break-inside: avoid; }

        /* Without this the browser drops backgrounds and the QR's white pad
           disappears into the page — which is what a scanner reads against. */
        * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      }
    `}</style>
  );
}
