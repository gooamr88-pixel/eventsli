/**
 * The API's shapes, as this app reads them. Each names the backend function
 * that produces it, so a change there has an obvious place to land here.
 */

/** authController.shapeIdentity */
export type User = {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
  accountTypes: string[];
};

/** POST /auth/app/login, /auth/app/token */
export type AppSession = { token: string; expiresAt: string; user: User };

export type Availability = {
  seatsTotal: number | null;
  seatsAvailable: number | null;
  soldOut: boolean;
  sellingFast?: boolean;
} | null;

/** discoveryController.shape (+ fromPriceCents/availability on a listing), or lockedListing. */
export type EventCard = {
  id: string;
  slug: string;
  title: string;
  isPrivate?: boolean;
  blurredCover?: boolean;
  comingSoon: boolean;
  venue: string | null;
  city: string | null;
  venueAddress: string | null;
  venueAddressFull?: string | null;
  country?: string;
  timezone: string | null;
  startsAt: string;
  endsAt: string | null;
  isPast: boolean;
  currency?: string;
  category: string | null;
  categoryLabel: string | null;
  coverUrl: string | null;
  displayOnly: boolean;
  admissionType?: 'reserved' | 'general';
  highlights?: string[];
  venueLocation?: { lat: number; lng: number } | null;
  maxTicketsPerOrder?: number | null;
  organizer: { name: string } | null;
  fromPriceCents: number | null;
  availability: Availability;
  /** GET /public/events/near */
  distanceKm?: number;
  /** GET /me/saved-events */
  savedAt?: string;
};

/** discoveryController.publicTier */
export type Tier = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  kind: string;
  free: boolean;
  /** Shown only through an organizer's ?tier= link; never listed. */
  hidden: boolean;
  maxPerOrder: number | null;
  notYetOnSale: boolean;
  salesEnded: boolean;
  onSale: boolean;
  remaining: number | null;
  soldOut: boolean;
  salesStartAt: string | null;
};

/** GET /public/events/:slug */
export type EventDetail = EventCard & {
  description: string | null;
  payments: { card: boolean; manual: boolean };
  purchasable: boolean;
  tiers: Tier[];
  organizerProfile?: { slug: string; name: string } | null;
};

/** GET /public/event-categories → labelled */
export type Category = { slug: string; label: string; blurb: string | null; imageUrl: string | null };

/** GET /public/cities */
export type City = { city: string; country: string; events: number };

/** GET /public/events/near */
export type NearAnswer = {
  places: { city: string; country: string; events: number; distanceKm: number }[];
  nearest: { city: string; country: string; distanceKm: number } | null;
  radiusKm: number;
  events: EventCard[];
};

/** GET /public/events/:slug/seat-map (seatMapController.publicMap) */
export type SeatMap = {
  event: {
    id: string; slug: string; title: string; currency: string;
    purchaseMode: string; admissionType: 'reserved' | 'general';
    maxTicketsPerOrder: number | null; startsAt: string; endsAt: string | null;
  };
  map: { id: string; version: number } | null;
  tiers: { id: string; name: string; priceCents: number; onSale: boolean; soldOut: boolean; maxPerOrder: number | null; description: string | null; kind: string }[];
  tables: {
    id: string; label: string; seatCount: number; priceCents: number | null;
    status: string; canBookWhole: boolean; isPrivate: boolean;
  }[];
  seats: {
    id: string; tableId: string | null; tierId: string | null; section: string | null;
    row: string | null; number: string | number | null; priceCents: number | null;
    available: boolean; reason?: string;
  }[];
  hiddenTableCount: number;
};

/** POST /public/events/:slug/hold (seatMapController.shapeHold) */
export type Hold = {
  reservationId: string;
  reservationToken: string;
  expiresAt: string;
  seatCount: number;
  subtotalCents: number;
  currency: string;
  tableLabel: string | null;
};

/** GET /public/reservations/:id/quote (pricingService.publicBreakdown) */
export type Quote = {
  currency: string;
  admits: number;
  lines: { label: string; amountCents: number; addon?: boolean }[];
  totalCents: number;
  expiresAt: string;
  heldForMs: number | null;
  event: {
    slug: string; title: string; venue: string | null; startsAt: string | null;
    timezone: string | null; coverUrl: string | null; city: string | null;
    organizerName: string | null;
  };
};

/** GET /public/checkout/:sessionId */
export type CheckoutResult = {
  status: string;
  sessionStatus?: string | null;
  order: { id: string; ticketCount?: number } | null;
};

/** ticketService.shape */
export type Ticket = {
  id: string;
  status: string;
  attendeeName: string | null;
  tierName: string | null;
  /** ticketService.placeOf — null for general admission. */
  seat: { section: string | null; row: string | null; number: string | number | null } | null;
  table: string | null;
  addons: string[];
  transferred: boolean;
  transferredAway: boolean;
  scannedAt: string | null;
  qr: string | null;
};

/** GET /tickets (ticketController.mine) */
export type Order = {
  orderId: string;
  received?: boolean;
  event: {
    id: string; title: string; slug: string; startsAt: string; endsAt: string | null;
    timezone: string | null; venue: string | null; cancelled: boolean;
  } | null;
  currency: string | null;
  totalCents: number | null;
  purchasedAt: string;
  tickets: Ticket[];
};

/** GET /me/notifications (meController.shapeNotification) */
export type AppNotification = {
  id: string;
  kind: 'tickets_issued' | 'ticket_received' | 'event_reminder' | 'event_cancelled' | 'event_moved' | 'welcome';
  title: string;
  body: string;
  eventId: string | null;
  eventSlug: string | null;
  coverUrl: string | null;
  orderId: string | null;
  read: boolean;
  createdAt: string;
};
