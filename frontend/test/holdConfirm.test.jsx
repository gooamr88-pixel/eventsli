import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HoldConfirm from '../src/app/checkout/[reservationId]/HoldConfirm';

/**
 * The hold confirmation — the step between choosing seats and paying for them.
 *
 * It sits on the money path, and the case that matters is the one nobody
 * exercises by hand: the hold that has already expired by the time somebody
 * comes back to the tab. Offering "Proceed to checkout" there sends a buyer
 * into a form that will refuse them at the end, after they have typed their
 * card details — which is the exact surprise this screen exists to prevent.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }) => <a href={href} {...rest}>{children}</a>,
}));

const quote = (over = {}) => ({
  currency: 'CAD',
  admits: 2,
  totalCents: 8690,
  lines: [],
  expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  heldForMs: 35 * 60_000,
  event: { slug: 'gala', title: 'An Evening on the Waterfront', venue: 'Harbourfront Centre' },
  ...over,
});

const live = {
  quote: quote(), formatted: '34:58', remaining: 34 * 60_000, expired: false,
  totalMs: 35 * 60_000, slug: 'gala',
};

describe('while the hold is live', () => {
  test('says what is held, for how long, and what it costs', () => {
    render(<HoldConfirm {...live} onProceed={() => {}} />);

    expect(screen.getByText('34:58')).toBeInTheDocument();
    expect(screen.getByText('An Evening on the Waterfront')).toBeInTheDocument();
    expect(screen.getByText('Harbourfront Centre')).toBeInTheDocument();
    expect(screen.getByText(/86\.90/)).toBeInTheDocument();
    expect(screen.getByText(/Admits 2 people/)).toBeInTheDocument();
  });

  test('proceeding is what reveals the form', async () => {
    const onProceed = vi.fn();
    const user = userEvent.setup();
    render(<HoldConfirm {...live} onProceed={onProceed} />);

    await user.click(screen.getByRole('button', { name: /proceed to checkout/i }));
    expect(onProceed).toHaveBeenCalledOnce();
  });

  test('the countdown is announced politely, not assertively', () => {
    // It changes every second. An assertive region would have a screen reader
    // interrupt itself sixty times a minute.
    render(<HoldConfirm {...live} onProceed={() => {}} />);
    expect(screen.getByText('34:58')).toHaveAttribute('aria-live', 'polite');
  });

  test('one seat admits a person, not people', () => {
    render(<HoldConfirm {...live} quote={quote({ admits: 1 })} onProceed={() => {}} />);
    expect(screen.getByText(/Admits 1 person$/)).toBeInTheDocument();
  });
});

describe('once it has expired', () => {
  const dead = { ...live, expired: true, remaining: 0, formatted: '00:00' };

  test('there is no way forward — only back to the event', () => {
    render(<HoldConfirm {...dead} onProceed={() => {}} />);

    expect(screen.queryByRole('button', { name: /proceed/i })).toBeNull();
    expect(screen.getByRole('link', { name: /back to the event/i })).toHaveAttribute('href', '/e/gala');
  });

  test('says plainly that nothing was charged', () => {
    // The one thing somebody wants to know when they find a dead hold.
    render(<HoldConfirm {...dead} onProceed={() => {}} />);
    expect(screen.getByText(/Nothing was charged/i)).toBeInTheDocument();
  });
});

describe('the ring', () => {
  const offset = () => {
    const circles = document.querySelectorAll('circle');
    return Number(circles[circles.length - 1].getAttribute('stroke-dashoffset'));
  };

  test('is hidden from assistive technology — the figure is the content', () => {
    const { container } = render(<HoldConfirm {...live} onProceed={() => {}} />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  test('empties as the time runs down', () => {
    const { unmount } = render(<HoldConfirm {...live} remaining={35 * 60_000} onProceed={() => {}} />);
    const full = offset();
    unmount();

    render(<HoldConfirm {...live} remaining={5 * 60_000} onProceed={() => {}} />);
    // More of the ring is dashed away with less time left.
    expect(offset()).toBeGreaterThan(full);
  });

  test('a hold reporting more time than its window does not erase the ring', () => {
    // An offset outside 0–1 draws nothing at all, and a restored session can
    // report exactly that.
    render(<HoldConfirm {...live} remaining={99 * 60_000} totalMs={35 * 60_000} onProceed={() => {}} />);
    expect(offset()).toBe(0);
  });

  test('an unknown window falls back to a full ring rather than an empty one', () => {
    // `heldForMs` is null when the reservation has no creation time to measure
    // against. The figure inside is still correct, so the ring must not read as
    // "no time left".
    render(<HoldConfirm {...live} totalMs={null} onProceed={() => {}} />);
    expect(offset()).toBe(0);
  });
});
