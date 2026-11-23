import { api, request } from './client';
import type {
  AppNotification, AppSession, Category, CheckoutResult, City, EventCard, EventDetail,
  Hold, NearAnswer, Order, Quote, SeatMap,
} from './types';

/**
 * Every call the app makes, named. Screens use these, never a raw path, so the
 * API surface this app depends on is readable in one file.
 */

// ─── Discovery (public) ─────────────────────────────────────────────────────

export type EventQuery = {
  q?: string;
  city?: string;
  category?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
  ticketedFirst?: boolean;
};

export const listEvents = (query: EventQuery, token?: string | null) =>
  request<EventCard[]>('/public/events', { query: { withPrivate: 'false', ...query }, token });

export const trending = () =>
  api<{ events: EventCard[]; chosen: boolean }>('/public/vip-events');

export const categories = () =>
  api<{ categories: string[]; labelled: Category[] }>('/public/event-categories').then((d) => d.labelled);

export const cities = () => api<{ cities: City[] }>('/public/cities').then((d) => d.cities);

export const eventsNear = (lat: number, lng: number) =>
  api<NearAnswer>('/public/events/near', { query: { lat, lng, limit: 24 } });

export const eventBySlug = (slug: string, token?: string | null) =>
  api<EventDetail>(`/public/events/${encodeURIComponent(slug)}`, { token });

export const seatMap = (slug: string, token?: string | null) =>
  api<SeatMap>(`/public/events/${encodeURIComponent(slug)}/seat-map`, { token });

// ─── Holding and paying ─────────────────────────────────────────────────────

export type HoldBody =
  | { seatIds: string[] }
  | { tableId: string }
  | { lines: { tierId: string; quantity: number }[] };

export const hold = (slug: string, body: HoldBody, token?: string | null) =>
  api<Hold>(`/public/events/${encodeURIComponent(slug)}/hold`, { method: 'POST', body, token });

export const release = (reservationId: string, reservationToken: string) =>
  api<{ released: boolean }>(`/public/reservations/${reservationId}/release`, { method: 'POST', reservationToken });

export const quote = (reservationId: string) =>
  api<Quote>(`/public/reservations/${reservationId}/quote`);

export const applyPromo = (reservationId: string, reservationToken: string, code: string) =>
  api<unknown>(`/public/reservations/${reservationId}/promo`, { method: 'POST', body: { code }, reservationToken });

export const removePromo = (reservationId: string, reservationToken: string) =>
  api<unknown>(`/public/reservations/${reservationId}/promo`, { method: 'DELETE', reservationToken });

export type Buyer = {
  name: string;
  email?: string;
  phone?: string;
  acceptTerms: true;
  /** signatureService: a typed name is the accessible alternative to drawing. */
  signature: { method: 'typed'; name: string };
};

export const startCheckout = (reservationId: string, reservationToken: string, buyer: Buyer, token?: string | null) =>
  api<{ checkoutUrl: string; sessionId: string }>(`/public/reservations/${reservationId}/checkout`, {
    method: 'POST', body: buyer, reservationToken, token,
  });

export const claimFree = (reservationId: string, reservationToken: string, buyer: Buyer, token?: string | null) =>
  api<{ orderId: string; ticketCount: number; free: true }>(`/public/reservations/${reservationId}/claim`, {
    method: 'POST', body: buyer, reservationToken, token,
  });

export const checkoutResult = (sessionId: string) =>
  api<CheckoutResult>(`/public/checkout/${encodeURIComponent(sessionId)}`);

// ─── Account ────────────────────────────────────────────────────────────────

const APP = { app: 'attendee' as const };

export const login = (email: string, password: string, deviceName?: string | null) =>
  api<AppSession>('/auth/app/login', { method: 'POST', body: { email, password, deviceName: deviceName || undefined, ...APP } });

export const register = (fullName: string, email: string, password: string) =>
  api<{ verificationRequired: boolean }>('/auth/register', {
    method: 'POST', body: { fullName, email, password, accountType: 'attendee' },
  });

export const verifyEmail = (email: string, code: string) =>
  api<unknown>('/auth/verify-email', { method: 'POST', body: { email, code } });

export const resendVerification = (email: string) =>
  api<unknown>('/auth/resend-verification', { method: 'POST', body: { email } });

export const forgotPassword = (email: string) =>
  api<unknown>('/auth/forgot-password', { method: 'POST', body: { email } });

export const logout = (token: string) => api<unknown>('/auth/logout', { method: 'POST', token });

// ─── Mine (signed in) ───────────────────────────────────────────────────────

export const myTickets = (token: string) => api<Order[]>('/tickets', { token });

export const savedEvents = (token: string, page = 1) =>
  request<EventCard[]>('/me/saved-events', { token, query: { page, limit: 50 } });

export const savedEventIds = (token: string) =>
  api<{ eventIds: string[] }>('/me/saved-events/ids', { token }).then((d) => d.eventIds);

export const saveEvent = (token: string, eventId: string) =>
  api<{ saved: boolean }>(`/me/saved-events/${eventId}`, { method: 'PUT', token });

export const unsaveEvent = (token: string, eventId: string) =>
  api<{ saved: boolean }>(`/me/saved-events/${eventId}`, { method: 'DELETE', token });

export const notifications = (token: string, page = 1) =>
  request<AppNotification[]>('/me/notifications', { token, query: { page, limit: 50 } });

export const markNotificationsRead = (token: string, body: { ids: string[] } | { all: true }) =>
  api<{ unread: number }>('/me/notifications/read', { method: 'POST', body, token });

export const registerPushDevice = (token: string, pushToken: string, platform: 'ios' | 'android') =>
  api<unknown>('/me/push-devices', { method: 'POST', body: { token: pushToken, platform }, token });

export const removePushDevice = (token: string, pushToken: string) =>
  api<unknown>('/me/push-devices', { method: 'DELETE', body: { token: pushToken }, token });
