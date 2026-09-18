'use client';

import { useCallback, useState } from 'react';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Saving a ticket — as a PDF, or on paper.
 *
 * NO PDF LIBRARY, AND THAT IS THE POINT. Every browser already has a print
 * engine that paginates, honours `@page`, and offers "Save as PDF" in the same
 * dialog. A library would mean shipping a few hundred kilobytes to every ticket
 * holder in order to produce a worse version of what the Print button already
 * does — and it would be a second layout to keep in step with this one. The
 * organizer's seating pack takes exactly the same position.
 *
 * ONE ORDER AT A TIME. `data-printing` marks the order being saved and the
 * print rules hide every other one, so somebody with eight orders does not get
 * eight events in one PDF when they wanted the one on Saturday.
 *
 * WHAT IS DELIBERATELY ABSENT: "Add to Apple Wallet". A `.pkpass` has to be
 * signed with a Pass Type ID certificate from an Apple Developer account —
 * there is no client-side version of it, and a button that produced an unsigned
 * pass would fail on the phone with an error the holder cannot act on. It needs
 * the certificate before it needs any code.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function TicketActions({ orderId, onPrintingChange }) {
  const [busy, setBusy] = useState(false);

  const print = useCallback(() => {
    setBusy(true);
    onPrintingChange(orderId);

    /**
     * Two frames, then print.
     *
     * `window.print()` blocks the main thread while the dialog is open, so
     * calling it in the same tick as the state change opens the dialog over a
     * layout React has not painted yet — the PDF comes out showing every order
     * instead of this one. One frame queues the paint, the second lets it
     * happen.
     */
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try {
        window.print();
      } finally {
        // In every engine `print()` returns only once the dialog is dismissed,
        // so this runs after the PDF has been written or cancelled.
        onPrintingChange(null);
        setBusy(false);
      }
    }));
  }, [orderId, onPrintingChange]);

  return (
    <button
      type="button"
      onClick={print}
      disabled={busy}
      className="es-btn es-btn--secondary es-btn--sm"
    >
      {busy ? 'Opening…' : 'Save as PDF'}
    </button>
  );
}

/**
 * The print rules for the tickets page.
 *
 * Scoped to this page and mounted with it rather than living in globals.css:
 * one of these rules hides the entire application, and a rule that can do that
 * must not be reachable from a page that is not this one.
 *
 * No `!important` anywhere — the project's check refuses them, and an element
 * selector beside the class is enough to beat any single utility class.
 */
export function TicketPrintStyles() {
  return (
    <style>{`
      @media print {
        @page { margin: 12mm; }

        /* The app around the tickets: header, navigation, footer. It is still
           in the DOM and would otherwise print above them. */
        body > *:not(.es-tickets-root) { display: none; }
        .es-tickets-root nav,
        .es-tickets-root header.es-appbar,
        .es-tickets-print-hide { display: none; }

        /* Only the order being saved. Without this, somebody with eight orders
           gets eight events in the PDF they wanted one event in. */
        .es-tickets-root[data-printing] .es-ticket-order { display: none; }
        .es-tickets-root[data-printing] .es-ticket-order[data-printing-this] { display: block; }

        /* A ticket is a QR code and the words beside it; splitting one across a
           page break leaves a code nobody can scan. */
        .es-ticket-stub { break-inside: avoid; }

        /* Without this the browser drops backgrounds, and the QR's white pad
           disappears into the page — which is what a scanner reads against. */
        * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      }
    `}</style>
  );
}
