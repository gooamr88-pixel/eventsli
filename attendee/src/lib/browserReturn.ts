import { AppState, type AppStateStatus } from 'react-native';

/**
 * WAITING FOR SOMEONE TO COME BACK FROM THE IN-APP BROWSER.
 *
 * On iOS `WebBrowser.openBrowserAsync` resolves when the Safari sheet closes.
 * On Android it resolves as soon as the Custom Tab OPENS ({ type: 'opened' },
 * expo-web-browser's own docs). Checkout used to ask the API "did they pay?"
 * at that moment — while the person was still typing their card — read
 * "unpaid, session open", and told them payment had failed (2026-11-27).
 *
 * The Custom Tab is another activity, so opening it sends the app to the
 * background and closing it brings the app back. Watch for that round trip:
 * start listening BEFORE the tab opens, so a fast tab cannot slip past.
 */
type AppStateLike = {
  addEventListener: (type: 'change', fn: (s: AppStateStatus) => void) => { remove: () => void };
};

export type ReturnWatch = {
  /** Resolves once the app has left the foreground and come back to it. */
  back: Promise<void>;
  /** Stop listening (resolves `back` so nothing is left waiting). */
  cancel: () => void;
};

export function watchForReturn(appState: AppStateLike = AppState): ReturnWatch {
  let left = false;
  let done: () => void = () => undefined;
  const back = new Promise<void>((resolve) => { done = resolve; });
  const sub = appState.addEventListener('change', (state) => {
    if (state === 'background' || state === 'inactive') left = true;
    else if (state === 'active' && left) finish();
  });
  function finish() {
    sub.remove();
    done();
  }
  return { back, cancel: finish };
}
