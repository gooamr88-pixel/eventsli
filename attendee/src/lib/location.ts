import * as Location from 'expo-location';

/**
 * "Near me", with as little location as will do.
 *
 * The phone is asked only when the person taps a "Turn on location" or "Near
 * me" button — never by surprise at launch. Once they have said yes, Home
 * uses it by itself (Near You), refreshed when the app comes back to the
 * front; there is no tracking in the background (the app does not hold that
 * permission at all — app.json blocks it).
 *
 * Balanced accuracy (a few hundred metres) is plenty to sort venues, and the
 * position is rounded to about a kilometre before it leaves the phone
 * (`rounded`). /public/events/near neither stores nor logs it.
 */
export type Position = { lat: number; lng: number };

/** Whether location may be read, without asking. */
export async function locationStatus(): Promise<'granted' | 'ask' | 'denied'> {
  try {
    const p = await Location.getForegroundPermissionsAsync();
    if (p.granted) return 'granted';
    return p.canAskAgain ? 'ask' : 'denied';
  } catch {
    return 'denied';
  }
}

async function fix(): Promise<Position | null> {
  const last = await Location.getLastKnownPositionAsync({ maxAge: 30 * 60_000 });
  const f = last ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return rounded({ lat: f.coords.latitude, lng: f.coords.longitude });
}

/** The position if location is already allowed — never shows the system prompt. */
export async function positionIfAllowed(): Promise<Position | null> {
  try {
    return (await locationStatus()) === 'granted' ? await fix() : null;
  } catch {
    return null;
  }
}

/** Asks if it may (the system prompt), then reads the position. */
export async function approximatePosition(): Promise<Position | 'denied' | null> {
  try {
    const current = await Location.getForegroundPermissionsAsync();
    let granted = current.granted;
    if (!granted && current.canAskAgain) granted = (await Location.requestForegroundPermissionsAsync()).granted;
    if (!granted) return 'denied';
    return await fix();
  } catch {
    return null;
  }
}

/** Two decimals — about a kilometre: enough to sort venues, not enough to find a door. */
export function rounded(p: Position): Position {
  return { lat: Math.round(p.lat * 100) / 100, lng: Math.round(p.lng * 100) / 100 };
}

/** "800 m away", "3.4 km away", "27 km away". */
export function distanceText(km: number | null | undefined): string {
  if (km === null || km === undefined || !Number.isFinite(km)) return '';
  if (km < 1) return `${Math.max(100, Math.round((km * 1000) / 100) * 100)} m away`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km away`;
}
