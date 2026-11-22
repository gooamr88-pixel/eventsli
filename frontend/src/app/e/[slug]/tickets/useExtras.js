'use client';

import { useState } from 'react';
import { put } from '../../../utils/apiClient';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The event's add-ons, chosen WITH the tickets, before checkout (owner,
 * 2026-11-22) — on the ticket picker and on the seat page alike.
 *
 * `addons` is the public event's list (`listForBuyer`: id, name, priceCents,
 * remaining, …); `tickets` is how many tickets or seats are chosen. At most one
 * extra per ticket and never past what the organizer has left; stepping the
 * tickets down trims the extras on read. The server checks both again, under a
 * lock, when `attachExtras` sends the choice onto the hold.
 *
 * `cents` is prices times quantities for the running figure only — labelled
 * "before fees" where it is shown. The real total is the quote's.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function useExtras(addons, tickets) {
  const [picked, setPicked] = useState({});
  const list = Array.isArray(addons) ? addons : [];
  const qty = (id) => Math.min(picked[id] || 0, tickets);

  const rows = list.map((a) => {
    const left = a.remaining === null || a.remaining === undefined ? null : a.remaining;
    return {
      ...a,
      mine: qty(a.id),
      ceiling: left === null ? tickets : Math.min(tickets, left),
      soldOut: left === 0,
      note: left !== null && left > 0 && left <= 10 ? `only ${left} left` : null,
    };
  });

  return {
    rows,
    count: list.reduce((n, a) => n + qty(a.id), 0),
    cents: list.reduce((sum, a) => sum + qty(a.id) * Number(a.priceCents || 0), 0),
    lines: list.map((a) => ({ addonId: a.id, quantity: qty(a.id) })).filter((l) => l.quantity > 0),
    set: (id, quantity) => setPicked((p) => ({ ...p, [id]: Math.max(0, Math.min(quantity, tickets)) })),
  };
}

/** Puts the chosen extras onto a fresh hold. Nothing chosen, nothing sent. */
export async function attachExtras(reservation, lines) {
  if (!lines.length) return;
  await put(
    `/public/reservations/${reservation.reservationId}/addons`,
    { lines },
    { headers: { 'x-access-token': reservation.reservationToken }, noRedirect: true },
  );
}
