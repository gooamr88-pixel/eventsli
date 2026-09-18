/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The focusable controls inside a dialog, in tab order.
 *
 * WHY THIS IS ONE FUNCTION AND NOT A SELECTOR COPIED INTO EACH DIALOG. Three
 * dialogs hand-rolled the same trap and two of them wrote the selector without
 * `:not([disabled])`, which does not fail loudly — it fails as a trap that
 * leaks, and only on the state where the last control happens to be disabled:
 *
 *   · Tab off the last ENABLED control matched nothing, so the browser walked
 *     focus out of the dialog into the page behind the scrim — the exact thing
 *     the trap exists to prevent.
 *   · Shift+Tab off the first control called `.focus()` on a DISABLED button,
 *     which silently does nothing, so backwards tabbing was dead.
 *
 * Both states are the one every one of these dialogs OPENS in: the submit
 * button is disabled until the field is filled, and the field starts empty.
 *
 * The `disabled` ATTRIBUTE is checked again after the selector, because `<a>`
 * carries no `disabled` state for `:not([disabled])` to catch and these dialogs
 * do contain links.
 *
 * Deliberately NOT filtered by `offsetParent` or by a computed style. It looks
 * like the thorough version and it is the broken one: jsdom performs no layout,
 * so `offsetParent` is null for every element there and the whole list empties
 * — a trap that silently stops trapping in exactly the environment its tests
 * run in. Nothing in these three dialogs hides a control without unmounting it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * @param {Element|null|undefined} root
 * @returns {HTMLElement[]} the controls that can actually take focus, in order
 */
export function focusablesIn(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('disabled'),
  );
}

/**
 * The Tab half of a modal's keydown handler: wraps focus at both ends.
 * Returns nothing and calls `preventDefault` only when it moves focus itself.
 *
 * @param {KeyboardEvent} e
 * @param {Element|null|undefined} root
 */
export function trapTab(e, root) {
  if (e.key !== 'Tab') return;
  const focusable = focusablesIn(root);
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
