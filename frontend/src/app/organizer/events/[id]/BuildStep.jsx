'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW "SAVE AND CONTINUE" ACTUALLY SAVES.
 *
 * The step bar at the foot of every build screen used to say "Next" and be a
 * plain `<Link>`. That was honest, and it was also the problem: every build
 * screen has its OWN "Save changes" button, so the way on from a screen did
 * not commit the screen. An organizer who edited three fields and pressed the
 * thing labelled "next step" lost all three, silently, on the screens that do
 * not guard navigation.
 *
 * Renaming it to "Save and continue" without changing what it does would have
 * made that worse rather than better — a button that says it saves and does
 * not is the one kind of label you cannot recover from.
 *
 * So a screen HANDS THE BAR ITS SAVE. `useStepSave(fn)` registers one; the bar
 * calls it, waits for it, and only moves on if it succeeds. A screen that
 * registers nothing gets the old behaviour — the bar just navigates — which is
 * correct for the screens whose edits are already committed row by row.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A REF, NOT STATE, and that is not a micro-optimisation.
 *
 * The handler changes identity on every render of the screen that owns it. In
 * state, registering it would set state during an effect on every render —
 * which `react-hooks/set-state-in-effect` refuses, and rightly: it is a render
 * React paints and throws away. Nothing reads the handler during render; it is
 * only ever called from a click. A ref is exactly the right shape for that.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const StepSaveContext = createContext(null);

export function BuildStepProvider({ children }) {
  /**
   * A SET, NOT ONE HANDLER, because a step is not always one form.
   *
   * Page & branding is four independent editors — gallery, schedule,
   * sponsors, policies — each with its own dirty state and its own save bar.
   * A single slot would have let the last one to mount overwrite the other
   * three, and "Save and continue" would have committed one quarter of the
   * screen while looking like it committed all of it. That is a worse failure
   * than not saving at all, because it is invisible.
   */
  const handlers = useRef(new Set());

  const register = useCallback((fn) => {
    handlers.current.add(fn);
    return () => { handlers.current.delete(fn); };
  }, []);

  /**
   * Returns whether it is safe to move on.
   *
   * `true` when nothing is registered — a screen that commits row by row has
   * nothing pending, so continuing is always fine. A handler that returns
   * `false` or throws keeps the reader where they are, with whatever error
   * its own form is already showing.
   *
   * ALL OF THEM RUN, even after one fails. Stopping at the first failure
   * would leave the other sections unsaved for no reason, and the reader
   * would have to press it again once per broken section to find them all.
   */
  const runSave = useCallback(async () => {
    const all = [...handlers.current];
    if (all.length === 0) return true;

    const settled = await Promise.all(all.map(async (fn) => {
      try {
        return (await fn()) !== false;
      } catch {
        return false;
      }
    }));
    return settled.every(Boolean);
  }, []);

  const value = useMemo(() => ({ register, runSave }), [register, runSave]);
  return <StepSaveContext.Provider value={value}>{children}</StepSaveContext.Provider>;
}

/**
 * A build screen's save, handed to the step bar.
 *
 * @param {() => Promise<boolean|void>} save  resolves false (or throws) to
 *   refuse the move — validation failed, the server said no. Anything else
 *   counts as saved.
 */
export function useStepSave(save) {
  const register = useContext(StepSaveContext)?.register;
  const latest = useRef(save);

  // In an effect rather than during render: writing a ref while rendering is
  // the kind of side effect that breaks under a re-render React discards.
  useEffect(() => { latest.current = save; });

  // Registered ONCE per mount, and the indirection through `latest` is why
  // that is safe — the bar always reaches today's closure.
  useEffect(() => {
    if (!register) return undefined;
    return register(() => latest.current?.());
  }, [register]);
}

/** The step bar's side of it. `null` outside a provider. */
export function useRunStepSave() {
  return useContext(StepSaveContext)?.runSave || null;
}
