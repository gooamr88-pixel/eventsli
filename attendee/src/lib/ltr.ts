import * as SecureStore from 'expo-secure-store';
import * as Updates from 'expo-updates';
import { DevSettings, I18nManager } from 'react-native';

/**
 * THE APP IS ENGLISH AND READS LEFT TO RIGHT, WHATEVER THE PHONE'S LANGUAGE.
 *
 * React Native mirrors every screen when the phone is set to an RTL language
 * (Arabic, Hebrew…): the tab bar runs backwards, text hugs the right edge,
 * back arrows point the wrong way — on an app whose every word is English
 * (owner's decision, 2026-11-08). That is what "the direction of the app is
 * terrible" was (2026-11-24, on an Arabic phone).
 *
 * allowRTL(false) is stored by the system and read when the app STARTS, so
 * the first launch after this change restarts once to take it. A stored flag
 * makes sure that happens at most once: if the phone still reports RTL after
 * the restart, the app carries on rather than restarting forever.
 */
const KEY = 'eventsli.app.ltrRestarted';

export function lockLeftToRight() {
  I18nManager.allowRTL(false);
  I18nManager.forceRTL(false);
  if (!I18nManager.isRTL) {
    void SecureStore.deleteItemAsync(KEY).catch(() => undefined);
    return;
  }
  void (async () => {
    try {
      if (await SecureStore.getItemAsync(KEY)) return;
      await SecureStore.setItemAsync(KEY, '1');
      if (__DEV__) DevSettings.reload();
      else await Updates.reloadAsync();
    } catch {
      // No restart possible: the next normal launch is left to right anyway.
    }
  })();
}
