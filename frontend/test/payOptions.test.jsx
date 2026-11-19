import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PayOptions from '../src/app/checkout/[reservationId]/PayOptions';

/**
 * "How will you pay?" — two choice cards on the checkout (2026-11-19).
 *
 * The amounts are what the cards exist to show side by side: paying the
 * organizer carries no card fee, so the two totals differ and the buyer is
 * choosing between them. The radios must stay real radios.
 */

const options = (over = {}) => ({
  card: true,
  available: true,
  dueAt: '2026-11-21T17:24:00Z',
  totalCents: 9500,
  currency: 'CAD',
  methods: [{ id: 'm1', label: 'Interac e-Transfer' }],
  ...over,
});

describe('PayOptions', () => {
  test('renders nothing when offline checkout is not offered', () => {
    const { container } = render(<PayOptions options={{ card: true, available: false }} mode="card" onMode={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('shows both choices, each with its own total', () => {
    render(<PayOptions options={options()} mode="card" onMode={() => {}} cardTotalCents={9815} currency="CAD" timezone="America/Toronto" />);
    const card = screen.getByRole('radio', { name: /pay by card now/i });
    const offline = screen.getByRole('radio', { name: /pay the organizer directly/i });
    expect(card).toBeChecked();
    expect(offline).not.toBeChecked();
    expect(card.closest('label')).toHaveTextContent('98.15');
    expect(offline.closest('label')).toHaveTextContent('95.00');
    expect(offline.closest('label')).toHaveTextContent(/Nov 21, 2026/);
  });

  test('choosing the organizer reports the mode; the method picker shows only then', async () => {
    const onMode = vi.fn();
    const { rerender } = render(<PayOptions options={options()} mode="card" onMode={onMode} cardTotalCents={9815} />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /pay the organizer directly/i }));
    expect(onMode).toHaveBeenCalledWith('offline');
    rerender(<PayOptions options={options()} mode="offline" onMode={onMode} cardTotalCents={9815} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  test('without card payments only the offline choice is offered', () => {
    render(<PayOptions options={options({ card: false })} mode="offline" onMode={() => {}} />);
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    expect(screen.queryByText(/pay by card now/i)).not.toBeInTheDocument();
  });
});
