import * as Location from 'expo-location';

/**
 * "Near me", with as little location as will do.
 *
 * Asked only when the person taps Near me, never at launch. Balanced accuracy
 * (a few hundred metres) is plenty to sort cities and venues; a precise fix
 * would be a stronger permission for no better answer. The coordinates go to
 * /public/events/near, which neither stores nor logs them (landingController),
 * and are not kept here either.
 */
export async function approximatePosition(): Promise<{ lat: number; lng: number } | 'denied' | null> {
  try {
    const current = await Location.getForegroundPermissionsAsync();
    let granted = current.granted;
    if (!granted && current.canAskAgain) granted = (await Location.requestForegroundPermissionsAsync()).granted;
    if (!granted) return 'denied';
    const last = await Location.getLastKnownPositionAsync({ maxAge: 30 * 60_000 });
    const fix = last ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lat: fix.coords.latitude, lng: fix.coords.longitude };
  } catch {
    return null;
  }
}
