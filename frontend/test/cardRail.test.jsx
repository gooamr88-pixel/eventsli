import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import CardRail from '../src/app/components/landing/CardRail';
import PaymentPlatforms from '../src/app/components/landing/PaymentPlatforms';

/**
 * The homepage's event rails page with dots only when the row overflows
 * (2026-11-17). jsdom has no layout, so widths are given by hand: the track
 * is 900px wide, each card 284px plus a 24px gap — three to a page.
 */
function layout({ cards, overflow }) {
  const proto = window.HTMLElement.prototype;
  vi.spyOn(proto, 'clientWidth', 'get').mockImplementation(function w() { return this.tagName === 'UL' ? 900 : 0; });
  vi.spyOn(proto, 'scrollWidth', 'get').mockImplementation(function w() {
    return this.tagName === 'UL' ? (overflow ? cards * 308 - 24 : 900) : 0;
  });
  vi.spyOn(proto, 'getBoundingClientRect').mockImplementation(() => ({ width: 284, height: 400, top: 0, left: 0, right: 284, bottom: 400 }));
  // Only the track's gap is faked; everything else is jsdom's real answer.
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
    const style = real(el, pseudo);
    if (el?.tagName !== 'UL') return style;
    return new Proxy(style, {
      get: (target, key) => (key === 'columnGap' ? '24px' : Reflect.get(target, key, target)),
    });
  });
}

function cards(n) {
  return Array.from({ length: n }, (_, i) => <li key={i}><a href={`/e/${i}`}>Event {i + 1}</a></li>);
}

beforeEach(() => {
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 1; });
});
afterEach(() => vi.restoreAllMocks());

describe('CardRail', () => {
  it('shows no controls when every card fits', async () => {
    layout({ cards: 3, overflow: false });
    await act(async () => { render(<CardRail label="Events">{cards(3)}</CardRail>); });
    expect(screen.queryByRole('group', { name: /choose a page/ })).toBeNull();
  });

  it('pages eight cards three at a time, with a dot per page', async () => {
    layout({ cards: 8, overflow: true });
    const scrollTo = vi.fn();
    window.HTMLElement.prototype.scrollTo = scrollTo;
    await act(async () => { render(<CardRail label="Events">{cards(8)}</CardRail>); });

    const dots = screen.getAllByRole('button', { name: /Show events?/ });
    expect(dots).toHaveLength(3);
    expect(dots[0]).toHaveAttribute('aria-current', 'true');
    expect(dots[2]).toHaveAccessibleName('Show events 7–8 of 8');
    expect(screen.getByRole('button', { name: 'Previous events' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Next events' }));
    expect(scrollTo).toHaveBeenCalled();
  });
});

describe('PaymentPlatforms', () => {
  it('names Stripe and the card brands, and never PayPal', () => {
    render(<PaymentPlatforms />);
    expect(screen.getByRole('heading', { name: 'Payment platforms we use' })).toBeInTheDocument();
    expect(screen.getByText('Stripe')).toBeInTheDocument();
    for (const name of ['Visa', 'Mastercard', 'American Express', 'Apple Pay', 'Google Pay']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    expect(document.body.textContent).not.toMatch(/paypal/i);
  });
});

/**
 * Pages of six (owner, 2026-11-24: "I need six events, not three only"):
 * with `pageSize`, the cards are grouped into pages of six — two rows of three
 * on a desktop — and the scroller pages one whole page at a time.
 */
describe('CardRail with pageSize', () => {
  it('groups the cards into pages of six, every card still in the page', () => {
    const { container } = render(<CardRail label="Events" pageSize={6}>{cards(14)}</CardRail>);
    const pages = container.querySelectorAll('.es-lp-rail--paged > .es-rail__page');
    expect(pages).toHaveLength(3);
    expect([...pages].map((p) => p.querySelectorAll('.es-rail__grid > li').length)).toEqual([6, 6, 2]);
    expect(screen.getByRole('link', { name: 'Event 14' })).toBeInTheDocument();
  });

  it('without pageSize nothing changes: the cards are the scroller\'s children', () => {
    const { container } = render(<CardRail label="Events">{cards(4)}</CardRail>);
    expect(container.querySelector('.es-lp-rail--paged')).toBeNull();
    expect(container.querySelectorAll('.es-lp-rail > li')).toHaveLength(4);
  });
});
