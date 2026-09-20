'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { trapTab } from '../utils/focusTrap';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A LAYOUT EFFECT, AND THE ORDER IS THE WHOLE REASON.
 *
 * This hook has to read `document.activeElement` BEFORE the dialog moves focus
 * into itself, because that reading is the only record of where focus came
 * from. Every one of these dialogs places its own initial focus in a passive
 * `useEffect` — the code field, the close button, the panel — and passive
 * effects run after layout effects, so a layout effect here is what puts the
 * capture first.
 *
 * Get that backwards and the bug is silent and exact: the hook records the
 * dialog's OWN close button as the opener, then on close calls `.focus()` on a
 * node that has just been unmounted, which does nothing. Focus restoration
 * appears to be implemented and restores nothing.
 *
 * `useLayoutEffect` warns when it runs on the server, and these are client
 * components that Next still server-renders. The standard swap keeps the
 * ordering in the browser and the silence on the server — where there is no
 * focus to capture and no listener to attach anyway.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const useBeforePaint = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERYTHING A HAND-ROLLED MODAL HAS TO DO, IN ONE PLACE.
 *
 * Three dialogs in this product are native `<dialog>` elements — Confirm,
 * LogoutConfirm and SubmitReview — and the browser gives them the whole
 * behaviour for free: Escape, the focus trap, inertness behind, and putting
 * focus BACK where it came from when they close.
 *
 * Six are not, for reasons that are individually good. The Lightbox and the
 * seating pack portal to `<body>`; the seat map's unlock prompt and the map
 * editor's add-element dialog are positioned against their canvas; Near me
 * animates between phases; Transfer is a two-step form. Each of those six then
 * hand-rolled the chrome, and they hand-rolled DIFFERENT SUBSETS of it:
 *
 *   Escape + Tab trap   all six          ✓ (that is what focusTrap.js is for)
 *   initial focus       five of six      — TransferDialog relies on autoFocus
 *   body scroll lock    two of six       — Lightbox and Near me only
 *   focus restoration   NONE of six
 *
 * The last row is the one that matters and it is invisible in testing, because
 * the native half of the dialogs does it correctly. Close the seat-map unlock
 * prompt with Escape and focus lands on `<body>`: the next Tab starts from the
 * top of the document, so a keyboard user is returned to the masthead instead
 * of to the table they were unlocking. On the ticket list it is worse, because
 * the thing they were on is a row in a list they now have to walk back down.
 *
 * The missing scroll lock is the phone version of the same bug: four of these
 * sit over a page that still scrolls behind them, so a thumb that drags on the
 * scrim moves the page underneath and the dialog appears to float away.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT DOES NOT DO, deliberately: IT NEVER PLACES THE INITIAL FOCUS.
 *
 * Each of these dialogs already knows better than a generic rule does. The
 * unlock prompt wants its code field, the seating pack and Near me want their
 * close button, the Lightbox and the add-element dialog want the labelled
 * panel itself so a reader hears what opened. A hook that picked "the first
 * focusable" would be wrong for five of the six.
 *
 * It is also what makes the capture above safe. If this hook both recorded the
 * opener AND moved focus, the two jobs would have to happen in one effect in a
 * fixed order relative to the dialog's own — and there is no ordering that is
 * correct for both, because the capture must come FIRST and a fallback focus
 * must come LAST. Leaving the second job to the caller removes the conflict
 * rather than arranging it.
 *
 * So each dialog keeps its own one-line focus effect. The contract is only
 * that it must be a passive `useEffect`, never `autoFocus` on a host node:
 * `autoFocus` is committed in the layout phase, which can beat this hook.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @param {{current: HTMLElement|null}} ref   the dialog element
 * @param {() => void} onClose                Escape, and whatever else closes it
 * @param {object}  [options]
 * @param {boolean} [options.active]          false while the dialog is closed
 * @param {boolean} [options.lockScroll]      false for one that is not an overlay
 * @param {boolean} [options.stopEscape]      stopPropagation on Escape, for a
 *                                            dialog over a canvas that has its
 *                                            own Escape handler
 * @param {(e: KeyboardEvent) => void} [options.onKeyDown]  extra keys (arrows).
 *                                            Called first; if it calls
 *                                            `preventDefault`, the rest is
 *                                            skipped.
 */
export function useModal(ref, onClose, {
  active = true,
  lockScroll = true,
  stopEscape = false,
  onKeyDown = null,
} = {}) {
  /**
   * The callbacks, held in refs so the effect below can depend on `active`
   * ALONE.
   *
   * Not a detail. Every one of these dialogs passes an inline arrow or a
   * `close` that changes identity on a state change, so an effect listing
   * `onClose` in its dependencies tears down and re-runs on almost every
   * render. It re-ran harmlessly when all it did was add a keydown listener —
   * which is why the existing versions get away with it — but this one also
   * captures "where focus came from", and re-running that mid-dialog would
   * record a control INSIDE the panel and restore focus to it after close.
   *
   * The ref is seeded from the first render rather than only by the effect
   * below, because that effect is passive and the listener is attached in a
   * layout effect — so on mount the handler would otherwise hold nothing.
   */
  const latest = useRef({ onClose, onKeyDown });
  useEffect(() => { latest.current = { onClose, onKeyDown }; });

  useBeforePaint(() => {
    if (!active) return undefined;

    /**
     * WHERE FOCUS CAME FROM, read before anything has moved it.
     *
     * Two things are excluded, and both would be worse than not restoring:
     *
     *   · `body` is what `document.activeElement` reports when nothing is
     *     focused at all. Restoring focus TO body is the same as not restoring
     *     it, so it is recorded as null and the browser is left alone.
     *
     *   · Anything already INSIDE the dialog. This should not happen given the
     *     ordering above, but a stray `autoFocus` on a host node is committed
     *     in the layout phase too and can beat this. Capturing a control that
     *     is about to be unmounted would mean restoring focus to nothing, and
     *     null at least leaves the browser's own fallback intact.
     */
    const active$ = document.activeElement;
    const inside = Boolean(ref.current && active$ && ref.current.contains(active$));
    const opener = active$ && active$ !== document.body && !inside ? active$ : null;

    const onKey = (e) => {
      /**
       * A NATIVE `<dialog>` OPENED ON TOP OF THIS ONE OWNS THE KEYBOARD.
       *
       * `showModal()` puts everything outside itself — this dialog included —
       * into the inert subtree and runs its own Tab trap. With both live, Tab
       * is handled twice: the native dialog keeps focus inside itself, then
       * this handler calls `preventDefault` and moves focus back into a subtree
       * that is inert, so focus lands somewhere the reader can neither see nor
       * use. Escape is the same in miniature — it would close this dialog out
       * from under the one asking the question.
       *
       * Checked against the DOM rather than tracked in state, because what
       * opened the native dialog is usually a child this hook knows nothing
       * about — a `useConfirm()` called from inside the panel. `AppShell`'s
       * drawer found this first; the reasoning is the same here.
       */
      if (document.querySelector('dialog[open]')) return;
      latest.current.onKeyDown?.(e);
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') {
        if (stopEscape) e.stopPropagation();
        latest.current.onClose?.();
        return;
      }
      trapTab(e, ref.current);
    };
    document.addEventListener('keydown', onKey);

    /**
     * The page behind must not scroll, and must not JUMP either.
     *
     * Removing the scrollbar shifts a desktop page sideways by its width — on
     * a hero with a full-bleed photograph that is a visible lurch at the exact
     * moment the dialog appears. `NearMeDialog` worked this out and the other
     * five did not; the compensation is now everyone's.
     *
     * Restored to whatever was there rather than to `''`, so a dialog opened
     * over another one does not unlock the page when only the inner one shuts.
     */
    const { body } = document;
    const previous = { overflow: body.style.overflow, pad: body.style.paddingInlineEnd };
    if (lockScroll) {
      const gap = window.innerWidth - document.documentElement.clientWidth;
      body.style.overflow = 'hidden';
      if (gap > 0) body.style.paddingInlineEnd = `${gap}px`;
    }

    return () => {
      document.removeEventListener('keydown', onKey);
      if (lockScroll) {
        body.style.overflow = previous.overflow;
        body.style.paddingInlineEnd = previous.pad;
      }
      /**
       * `isConnected`, because the opener is often gone by now.
       *
       * The control that opened one of these is frequently re-rendered or
       * removed by the very action that closed it — a transferred ticket's row
       * is replaced, an unlocked table's button becomes a different button.
       * Calling `.focus()` on a detached node does nothing at all, silently, so
       * the check is what makes the difference between restoring focus and
       * quietly dropping it on the floor.
       */
      if (opener?.isConnected) opener.focus?.();
    };
  }, [ref, active, lockScroll, stopEscape]);
}
