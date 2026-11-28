import * as Device from 'expo-device';
import * as ScreenOrientation from 'expo-screen-orientation';

/**
 * PHONES STAY UPRIGHT; TABLETS TURN (2026-11-28).
 *
 * `orientation: "portrait"` in app.json locked every device, so an Android
 * tablet (Android 15 and older) never reached the wide layout — the tab rail
 * and two-pane event, seat-map and checkout pages (ui/layout.tsx, wide ≥ 1024
 * pt). iPads were already free: Expo writes all four orientations under
 * `UISupportedInterfaceOrientations~ipad` whenever `supportsTablet` is on.
 *
 * Now app.json allows every orientation and the phone is locked here, at
 * launch, which is Expo's documented way to tell the two apart. A device that
 * does not say what it is counts as a phone: the phone layouts are the ones
 * built for portrait.
 */
export function shouldLockPortrait(type: Device.DeviceType | null): boolean {
  return type !== Device.DeviceType.TABLET && type !== Device.DeviceType.DESKTOP && type !== Device.DeviceType.TV;
}

export function lockPhonesToPortrait() {
  if (!shouldLockPortrait(Device.deviceType)) return;
  ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => undefined);
}
