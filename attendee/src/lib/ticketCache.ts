import { deleteAsync, documentDirectory, readAsStringAsync, writeAsStringAsync } from 'expo-file-system/legacy';

import type { Order } from '../api/types';

/**
 * MY TICKETS, KEPT ON THE PHONE — so the QR opens in a basement with no
 * signal even after the phone has closed the app.
 *
 * The query cache lives in memory only. Without this file a cold start with
 * no signal showed an empty My Tickets at the door (2026-11-27). It holds the
 * last list /tickets returned, stamped with the account it belongs to: a
 * different account signing in on the same phone never sees it, and signing
 * out deletes it.
 *
 * Not the Keychain: SecureStore values are meant to stay small (about 2 KB),
 * and an order list with QR tokens is larger. The app's own documents folder
 * is private to the app; the codes in it are the same ones in the email.
 */

const FILE = documentDirectory ? `${documentDirectory}eventsli-tickets.json` : null;
const VERSION = 1;

type Packed = { v: number; userId: string; savedAt: number; orders: Order[] };

export function pack(userId: string, orders: Order[], savedAt = Date.now()): string {
  return JSON.stringify({ v: VERSION, userId, savedAt, orders } satisfies Packed);
}

/** The orders, if the file is ours and belongs to this account; else null. */
export function unpack(raw: string | null | undefined, userId: string): { orders: Order[]; savedAt: number } | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<Packed>;
    if (p.v !== VERSION || p.userId !== userId || !Array.isArray(p.orders) || typeof p.savedAt !== 'number') return null;
    return { orders: p.orders, savedAt: p.savedAt };
  } catch {
    return null;
  }
}

export async function saveTickets(userId: string, orders: Order[]): Promise<void> {
  if (!FILE) return;
  try {
    await writeAsStringAsync(FILE, pack(userId, orders));
  } catch {
    // A full disk costs the offline copy, never the screen.
  }
}

export async function loadTickets(userId: string): Promise<{ orders: Order[]; savedAt: number } | null> {
  if (!FILE) return null;
  try {
    return unpack(await readAsStringAsync(FILE), userId);
  } catch {
    return null; // no file yet
  }
}

export async function clearTickets(): Promise<void> {
  if (!FILE) return;
  await deleteAsync(FILE, { idempotent: true }).catch(() => undefined);
}
