import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ctaFor, EventPurchaseNotice } from '../src/app/e/[slug]/EventPurchasePanel';
import EventTicketCard from '../src/app/e/[slug]/EventTicketCard';

/**
 * Ended and sold-out events (owner, 2026-11-20): a clear section in place of
 * the call to buy, no way in to a purchase, and the next steps instead.
 */
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }) => <a href={href} {...rest}>{children}</a> }));

const base = { slug: 'gala', title: 'Gala', admissionType: 'general', tiers: [{ priceCents: 2000 }], venue: 'The Hall', city: 'Toronto' };

describe('ctaFor', () => {
  test('an event that is over is "ended" — even when it also sold out', () => {
    expect(ctaFor({ ...base, isPast: true }, true).kind).toBe('ended');
    expect(ctaFor({ ...base, isPast: true, displayOnly: true }, false).kind).toBe('ended');
  });
  test('sold out and on sale are unchanged', () => {
    expect(ctaFor(base, true).kind).toBe('soldout');
    expect(ctaFor(base, false).kind).toBe('buy');
  });
});

describe('the status section', () => {
  test('ended: says so, when and where, and offers what next — no way to buy', () => {
    render(<EventTicketCard event={{ ...base, isPast: true, organizerProfile: { slug: 'acme', name: 'Acme Live' } }}
      soldOut={false} when={{ date: 'Nov 19, 2026' }} />);
    expect(screen.getByRole('heading', { name: 'This event has ended' })).toBeInTheDocument();
    expect(screen.getByText('Nov 19, 2026')).toBeInTheDocument();
    expect(screen.getByText('The Hall, Toronto')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Browse upcoming events/ })).toHaveAttribute('href', '/events');
    expect(screen.getByRole('link', { name: 'More from Acme Live' })).toHaveAttribute('href', '/o/acme');
    expect(screen.getByRole('link', { name: 'Find my tickets' })).toHaveAttribute('href', '/tickets/find');
    expect(screen.queryByRole('link', { name: /Buy tickets|Book tickets|Book your ticket/ })).toBeNull();
  });

  test('sold out: says so, with the right noun for the event', () => {
    const { rerender } = render(<EventTicketCard event={base} soldOut />);
    expect(screen.getByRole('heading', { name: 'Every ticket has been sold' })).toBeInTheDocument();
    expect(screen.getByText(/Tickets sometimes/)).toBeInTheDocument();
    rerender(<EventTicketCard event={{ ...base, admissionType: 'reserved' }} soldOut />);
    expect(screen.getByText(/Seats sometimes/)).toBeInTheDocument();
  });

  test('the grey notice does not repeat it', () => {
    const { container } = render(<EventPurchaseNotice event={{ ...base, isPast: true }} soldOut={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
