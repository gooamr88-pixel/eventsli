import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  BuildStepProvider, useStepSave, useRunStepSave,
} from '../src/app/organizer/events/[id]/BuildStep';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "SAVE AND CONTINUE" HAS TO MEAN IT.
 *
 * The step bar at the foot of every build screen used to say "Next" and be a
 * plain link — so the way on from a screen did not commit the screen, and the
 * edits went with it. The rename is only safe because of this registry, which
 * makes these the tests that hold the label honest.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** A build screen that hands the bar a save. */
function Screen({ save }) {
  useStepSave(save);
  return null;
}

/** The bar. Reports what `runSave` answered, so a test can assert on it. */
function Bar({ onResult }) {
  const runSave = useRunStepSave();
  return (
    <button type="button" onClick={async () => onResult(await runSave())}>
      Save and continue
    </button>
  );
}

const press = () => userEvent.click(screen.getByRole('button', { name: 'Save and continue' }));

describe('the build step save registry', () => {
  test('a screen with nothing registered is free to move on', async () => {
    const result = vi.fn();
    render(<BuildStepProvider><Bar onResult={result} /></BuildStepProvider>);
    await press();
    // Tiers, table categories and discounts commit row by row, so there is
    // never anything pending on them. They must not be blocked.
    expect(result).toHaveBeenCalledWith(true);
  });

  test('a registered save runs, and its answer decides', async () => {
    const save = vi.fn().mockResolvedValue(true);
    const result = vi.fn();
    render(
      <BuildStepProvider>
        <Screen save={save} />
        <Bar onResult={result} />
      </BuildStepProvider>,
    );
    await press();
    expect(save).toHaveBeenCalledTimes(1);
    expect(result).toHaveBeenCalledWith(true);
  });

  test('a save that refuses keeps the reader where the error is', async () => {
    const result = vi.fn();
    render(
      <BuildStepProvider>
        <Screen save={async () => false} />
        <Bar onResult={result} />
      </BuildStepProvider>,
    );
    await press();
    expect(result).toHaveBeenCalledWith(false);
  });

  test('a save that throws blocks rather than escaping', async () => {
    const result = vi.fn();
    render(
      <BuildStepProvider>
        <Screen save={async () => { throw new Error('the server said no'); }} />
        <Bar onResult={result} />
      </BuildStepProvider>,
    );
    await press();
    expect(result).toHaveBeenCalledWith(false);
  });

  /**
   * Page & branding is four editors — gallery, schedule, sponsors, policies —
   * each with its own draft. A single-slot registry would have saved whichever
   * mounted last and silently dropped the rest.
   */
  test('every section on a screen saves, not just the last one to mount', async () => {
    const a = vi.fn().mockResolvedValue(true);
    const b = vi.fn().mockResolvedValue(true);
    const c = vi.fn().mockResolvedValue(true);
    const result = vi.fn();
    render(
      <BuildStepProvider>
        <Screen save={a} /><Screen save={b} /><Screen save={c} />
        <Bar onResult={result} />
      </BuildStepProvider>,
    );
    await press();
    for (const save of [a, b, c]) expect(save).toHaveBeenCalledTimes(1);
    expect(result).toHaveBeenCalledWith(true);
  });

  test('one failing section does not stop the others from saving', async () => {
    // Otherwise a reader fixes one section, presses again, and discovers the
    // next failure one press at a time.
    const ok = vi.fn().mockResolvedValue(true);
    const bad = vi.fn().mockResolvedValue(false);
    const result = vi.fn();
    render(
      <BuildStepProvider>
        <Screen save={bad} /><Screen save={ok} />
        <Bar onResult={result} />
      </BuildStepProvider>,
    );
    await press();
    expect(ok).toHaveBeenCalledTimes(1);
    expect(result).toHaveBeenCalledWith(false);
  });

  test('a screen that has gone takes its save with it', async () => {
    const save = vi.fn().mockResolvedValue(true);
    const result = vi.fn();
    const { rerender } = render(
      <BuildStepProvider>
        <Screen save={save} />
        <Bar onResult={result} />
      </BuildStepProvider>,
    );
    // Navigating away unmounts the screen; the bar must not then be holding a
    // handler that writes to a form nobody is looking at.
    rerender(<BuildStepProvider><Bar onResult={result} /></BuildStepProvider>);
    await press();
    expect(save).not.toHaveBeenCalled();
    expect(result).toHaveBeenCalledWith(true);
  });

  test('the bar always calls the screen’s CURRENT save, not the one it mounted with', async () => {
    const first = vi.fn().mockResolvedValue(true);
    const latest = vi.fn().mockResolvedValue(true);
    const result = vi.fn();
    const { rerender } = render(
      <BuildStepProvider>
        <Screen save={first} />
        <Bar onResult={result} />
      </BuildStepProvider>,
    );
    // The handler is a fresh closure on every render of the screen — it has to
    // reach today's form state, not the state it had when it first mounted.
    rerender(
      <BuildStepProvider>
        <Screen save={latest} />
        <Bar onResult={result} />
      </BuildStepProvider>,
    );
    await press();
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });
});
