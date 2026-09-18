'use client';

import { useEffect } from 'react';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * AFTER A REFUSED SUBMIT, PUT THE CURSOR ON THE PROBLEM.
 *
 * THE BUG THIS FIXES. A form validated on submit would render its errors and
 * say nothing: focus stayed on the button that had just appeared to do nothing,
 * and a screen reader user heard silence. On the create-event wizard that meant
 * pressing "Continue", being refused, and having no way to find out why without
 * hunting back up the form.
 *
 * WHY NOT `role="alert"` ON THE ERROR TEXT, which is the obvious fix and the
 * wrong one here. `Field` is shared by every form in the app, and most of them
 * validate AS YOU TYPE — "3 more to go" under a password box is re-rendered on
 * every keystroke. An alert on that element would interrupt the screen reader
 * once per character, which is worse than silence: people turn off what
 * interrupts them. The live-validated fields already announce correctly,
 * because the reader is inside the field and `Field` wires `aria-invalid` and
 * `aria-describedby` to it.
 *
 * So the gap is only the SUBMIT-TIME case, and moving focus is the fix for it.
 * Focusing an invalid control announces its label, its invalid state and its
 * error message in one go — all of it wiring `Field` already has — and it does
 * the sighted equivalent too: the page scrolls to the problem instead of
 * leaving somebody to find it.
 *
 * `attempt` is a COUNTER, not a boolean. A boolean stays true across a second
 * refused submit, the effect does not re-run, and the second press really does
 * do nothing. Callers increment it on every failed attempt.
 *
 *   const [attempt, setAttempt] = useState(0);
 *   useFocusFirstInvalid(formRef, attempt);
 *   // in the submit handler, when invalid:
 *   setShowErrors(true);
 *   setAttempt((n) => n + 1);
 *
 * @param {{current: HTMLElement|null}} ref   the form, or any container
 * @param {number} attempt                    incremented per refused submit
 */
export function useFocusFirstInvalid(ref, attempt) {
  useEffect(() => {
    // 0 is "nothing submitted yet". Without this the first render of every
    // form would steal focus into whichever field happens to start invalid.
    if (!attempt) return;

    /**
     * `aria-invalid` is what `Field` sets on a refused input, select or
     * textarea. `data-invalid` is the radio-group equivalent: `aria-invalid`
     * is not allowed on `role="radio"`, so `RadioCards` marks its first option
     * with a data attribute instead purely so there is something here to aim
     * at. Both in one selector, in document order, so whichever comes first on
     * the page is the one focused.
     */
    const target = ref.current?.querySelector(
      '[aria-invalid="true"]:not([disabled]), [data-invalid="true"]:not([disabled])',
    );
    if (!target) return;

    target.focus({ preventScroll: true });
    // Focused first, scrolled second, and `preventScroll` above is why: the
    // browser's own focus scroll jumps the field to the very top edge, often
    // under a sticky header. This brings it to the middle instead.
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [ref, attempt]);
}
