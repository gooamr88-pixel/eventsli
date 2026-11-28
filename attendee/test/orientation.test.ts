jest.mock('expo-screen-orientation', () => ({ lockAsync: jest.fn(async () => undefined), OrientationLock: { PORTRAIT_UP: 3 } }));

import { DeviceType } from 'expo-device';

import { shouldLockPortrait } from '../src/lib/orientation';

/** Phones stay upright; tablets (and desktops, TVs) may turn (2026-11-28). */
it('locks phones, and a device that does not say what it is, to portrait', () => {
  expect(shouldLockPortrait(DeviceType.PHONE)).toBe(true);
  expect(shouldLockPortrait(DeviceType.UNKNOWN)).toBe(true);
  expect(shouldLockPortrait(null)).toBe(true);
});

it('lets tablets, desktops and TVs turn', () => {
  expect(shouldLockPortrait(DeviceType.TABLET)).toBe(false);
  expect(shouldLockPortrait(DeviceType.DESKTOP)).toBe(false);
  expect(shouldLockPortrait(DeviceType.TV)).toBe(false);
});
