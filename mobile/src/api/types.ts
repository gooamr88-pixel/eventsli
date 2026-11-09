/**
 * The API's shapes, from docs/CHECKIN-APP-API.md. Field names are the server's
 * own (some snake_case, from the database functions) so nothing is renamed in
 * transit and a mismatch shows up here, not on a door.
 */

export type User = {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
  accountTypes: string[];
};

export type AccountSession = { token: string; expiresAt: string; user: User };

export type EventCard = {
  id: string;
  title: string;
  slug: string;
  status: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  venue: string | null;
  city: string | null;
  coverUrl: string | null;
  as: 'organizer' | 'staff';
  scannable: boolean;
  stats: { issued: number; admitted: number };
};

export type Assignments = { upcoming: EventCard[]; ongoing: EventCard[]; past: EventCard[] };

export type DoorToken = {
  token: string;
  device: { id: string; label: string; eventId: string; staff?: boolean };
  event?: { id: string; title: string };
};

export type Role = 'owner' | 'staff' | 'pin';

export type Permissions = {
  viewGuests: boolean;
  manualCheckIn: boolean;
  fullNames: boolean;
  analytics: boolean;
  offlineAdmission: boolean;
  offlineNames: boolean;
};

export type GateState = { locked: boolean; reason?: string; override?: boolean };
export type Stats = { issued: number; admitted: number; pending: number; void: number };

export type DoorEvent = {
  id: string;
  title: string;
  slug: string;
  status: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  venue: string | null;
  address: string | null;
  city: string | null;
  coverUrl: string | null;
};

export type Me = {
  device: { id: string; label: string; kind: 'staff' | 'pin' };
  role: Role;
  event: DoorEvent | null;
  permissions: Permissions;
  settings: {
    doorTeamCanViewGuests: boolean;
    offlineAdmission: boolean;
    offlineShowNames: boolean;
    legacyQrOffline: 'allow' | 'hold';
  };
  gate: GateState | null;
  stats: Stats | null;
};

/** Every value `result` can take. The contract test keeps this list honest. */
export type ScanResultCode =
  | 'admitted' | 'duplicate' | 'transferred' | 'void' | 'event_cancelled' | 'event_not_open'
  | 'not_found' | 'invalid' | 'wrong_event' | 'scanner_locked' | 'error'
  | 'undone' | 'not_scanned';

export type ScanAnswer = {
  ok: boolean;
  result: ScanResultCode | string;
  message?: string;
  replay?: boolean;
  conflict?: boolean;
  scanned_at?: string;
  ticket_id?: string;
  attendee?: string | null;
  holder_is_buyer?: boolean;
  tier?: string | null;
  tier_kind?: string | null;
  seat?: string | null;
  table?: string | null;
  event_title?: string;
  event_starts_at?: string;
  event_timezone?: string;
  method?: 'scan' | 'manual' | 'offline';
  first_scan?: { at: string; device: string | null; staff: string | null };
  reason?: string;
};

export type RecentScan = {
  id: string;
  result: string;
  method: string;
  conflict: boolean;
  at: string;
  ticketId: string | null;
  holder: string | null;
  tier: string | null;
  device: string | null;
  staff: string | null;
};

export type Attendee = {
  ticketId: string;
  status: 'valid' | 'scanned';
  scannedAt: string | null;
  holder: string | null;
  holderIsBuyer: boolean;
  tier: string | null;
  seat: string | null;
  table: string | null;
};

export type Page = { total: number; limit: number; offset: number; hasMore: boolean };

export type TicketDetail = {
  ticketId: string;
  status: 'valid' | 'scanned' | 'void';
  orderPaid: boolean;
  scannedAt: string | null;
  qrVersion: number;
  transferred: boolean;
  holder: string | null;
  holderIsBuyer: boolean;
  tier: string | null;
  seat: string | null;
  table: string | null;
  history: {
    result: string; method: string; conflict: boolean; at: string;
    device: string | null; staff: string | null; detail: string | null;
  }[];
};

export type Analytics = {
  bucketMinutes: number;
  stats: Stats;
  timeline: { at: string; admitted: number }[];
  byTier: { tier: string | null; issued: number; admitted: number }[];
  byDevice: { device: string | null; staff: string | null; admitted: number }[];
  byMethod: Record<string, number>;
  refusals: { result: string; count: number }[];
  conflicts: number;
  lastFiveMinutes: number;
  peak: { at: string; admitted: number } | null;
  firstAt: string | null;
  lastAt: string | null;
};

export type AppConfig = {
  minSupportedVersion: { ios: string; android: string };
  storeUrls: { ios: string | null; android: string | null };
  signInUrl: string;
  supportUrl: string | null;
};

/** One ticket in the event's list for deciding offline (GET /scan/manifest). */
export type ManifestRow = {
  ticketId: string;
  v: number;
  status: 'valid' | 'scanned' | 'void';
  scannedAt: string | null;
  tier: string | null;
  seat: string | null;
  table: string | null;
  holder: string | null;
};

export type ManifestPage = {
  rows: ManifestRow[];
  cursor: string;
  done: boolean;
  reset: boolean;
  names: boolean;
  event: { status: string; startsAt: string; endsAt: string } | null;
  gateLocked: boolean;
  legacyQrOffline: 'allow' | 'hold';
  serverTime: string;
};

/** A public key that verifies QR v2 codes (GET /scan/keys). */
export type PublicJwk = { kid: string; kty: string; crv: string; alg?: string; use?: string; x: string; y: string };
