import { api, request } from './client';
import type {
  AccountSession, Analytics, AppConfig, Assignments, Attendee, DoorToken, ManifestPage, Me, Page,
  PublicJwk, RecentScan, ScanAnswer, TicketDetail,
} from './types';

/**
 * Every call the app makes, named for what it does. Two tokens: the ACCOUNT
 * session (who you are) and the DOOR token (which event, as which device).
 * See docs/CHECKIN-APP-API.md.
 */

export const REDIRECT_URI = 'eventsli-checkin://auth/callback';

// ── Account ─────────────────────────────────────────────────────────────────
export const appConfig = () => api<AppConfig>('/app/config', { timeoutMs: 8000 });

export const passwordLogin = (email: string, password: string, deviceName: string | null) =>
  api<AccountSession>('/auth/app/login', { method: 'POST', body: { email, password, deviceName } });

export const exchangeCode = (code: string, codeVerifier: string, deviceName: string | null) =>
  api<AccountSession>('/auth/app/token', {
    method: 'POST', body: { code, codeVerifier, redirectUri: REDIRECT_URI, deviceName },
  });

export const logout = (token: string) => api<{ loggedOut: boolean }>('/auth/logout', { method: 'POST', token });

export const assignments = (token: string) =>
  api<Assignments>('/scan/assignments', { token, query: { scope: 'all' } });

export const openDoor = (token: string, eventId: string) =>
  api<DoorToken>('/scan/staff-login', { method: 'POST', token, body: { eventId } });

export const pinLogin = (deviceId: string, pin: string) =>
  api<DoorToken>('/scan/login', { method: 'POST', body: { deviceId, pin } });

// ── The door ────────────────────────────────────────────────────────────────
export const me = (door: string) => api<Me>('/scan/me', { token: door });

export const status = (door: string) =>
  api<{ gate: Me['gate']; stats: Me['stats'] }>('/scan/status', { token: door, timeoutMs: 8000 });

/**
 * A scan answer is a 200 even when it is a refusal. The one exception, a
 * locked gate, is a 403 — returned here as the answer it is, not thrown.
 */
async function scanCall(path: string, door: string, body: unknown, timeoutMs: number): Promise<ScanAnswer> {
  try {
    return await api<ScanAnswer>(path, { method: 'POST', token: door, body, timeoutMs });
  } catch (err: any) {
    if (err?.code === 'SCANNER_LOCKED') {
      return { ok: false, result: 'scanner_locked', message: err.message, reason: err.meta?.reason };
    }
    throw err;
  }
}

export const verify = (door: string, qr: string, clientScanId: string, occurredAt: string, timeoutMs = 4000) =>
  scanCall('/scan/verify', door, { qr, clientScanId, occurredAt }, timeoutMs);

export const manualCheckIn = (door: string, ticketId: string, clientScanId: string) =>
  scanCall('/scan/manual-check-in', door, { ticketId, clientScanId }, 8000);

export type QueuedScan = {
  qr: string; clientScanId: string; occurredAt: string; method?: 'scan' | 'offline' | 'manual'; offlineVerdict?: string;
};
export const sync = (door: string, scans: QueuedScan[]) =>
  api<{ results: (ScanAnswer & { clientScanId: string })[]; summary: { total: number; admitted: number; replayed: number; conflicts: number } }>(
    '/scan/sync', { method: 'POST', token: door, body: { scans }, timeoutMs: 30000 },
  );

export const undo = (door: string, ticketId: string) =>
  api<{ ok: boolean; result: string }>('/scan/undo', { method: 'POST', token: door, body: { ticketId } });

export const recent = (door: string, opts: { limit?: number; kind?: 'admitted' | 'all'; before?: string } = {}) =>
  api<RecentScan[]>('/scan/recent', { token: door, query: opts });

export async function attendees(door: string, opts: { q?: string; status?: 'all' | 'in' | 'out'; offset?: number }) {
  const res = await request<Attendee[]>('/scan/attendees', { token: door, query: { ...opts, limit: 50 } });
  return { rows: res.data, page: res.pagination as Page };
}

export const ticket = (door: string, ticketId: string) =>
  api<TicketDetail>(`/scan/tickets/${encodeURIComponent(ticketId)}`, { token: door });

export const analytics = (door: string, bucket = 15) =>
  api<Analytics>('/scan/analytics', { token: door, query: { bucket } });

// ── Offline admission ───────────────────────────────────────────────────────
/** One page of the event's ticket list; call with the cursor it returns until `done`. */
export const manifest = (door: string, cursor: string | null) =>
  api<ManifestPage>('/scan/manifest', { token: door, query: { cursor }, timeoutMs: 20000 });

/** The public keys that verify QR v2 codes on this phone. */
export const keys = (door: string) => api<{ keys: PublicJwk[] }>('/scan/keys', { token: door });
