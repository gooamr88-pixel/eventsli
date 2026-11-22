import { describe, test, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HolderForms, { holderPayload } from '../src/app/checkout/[reservationId]/HolderForms';

/**
 * Who each ticket is for (2026-11-19): a card per ticket on orders of two or
 * more, first name required when the event says so, and "Use my details"
 * filling the first card from the buyer's own.
 */
const slots = [
  { key: 'seat:a', title: 'Ticket 1', place: 'Table 4 · Seat 1', tierName: 'Gold' },
  { key: 'seat:b', title: 'Ticket 2', place: 'Table 4 · Seat 2', tierName: 'Gold' },
];

function Harness({ mode = 'required', onValues = () => {} }) {
  const [values, setValues] = useState({});
  return (
    <HolderForms
      holders={{ mode, slots }}
      values={values}
      onChange={(v) => { setValues(v); onValues(v); }}
      buyer={{ name: 'Ana Maria Buyer', email: 'ana@example.com' }}
      phone="+1 416 555 0199"
      error={null}
    />
  );
}

describe('HolderForms', () => {
  test('nothing to ask: renders nothing', () => {
    const { container } = render(<HolderForms holders={{ mode: 'required', slots: [] }} values={{}} onChange={() => {}} buyer={{}} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('a card per ticket, named by its place; first name required when the event says so', () => {
    render(<Harness />);
    expect(screen.getByText(/Table 4 · Seat 1/)).toBeInTheDocument();
    expect(screen.getByText(/Table 4 · Seat 2/)).toBeInTheDocument();
    const firsts = screen.getAllByLabelText(/First name/);
    expect(firsts).toHaveLength(2);
    for (const f of firsts) expect(f).toBeRequired();
    for (const l of screen.getAllByLabelText(/Last name/)) expect(l).not.toBeRequired();
  });

  test('optional: nothing required', () => {
    render(<Harness mode="optional" />);
    for (const f of screen.getAllByLabelText(/First name/)) expect(f).not.toBeRequired();
  });

  test('"Use my details" fills the first card from the buyer', async () => {
    const user = userEvent.setup();
    const seen = vi.fn();
    render(<Harness onValues={seen} />);
    await user.click(screen.getByRole('button', { name: 'Use my details' }));
    expect(screen.getAllByLabelText(/First name/)[0]).toHaveValue('Ana');
    expect(screen.getAllByLabelText(/Last name/)[0]).toHaveValue('Maria Buyer');
    expect(screen.getAllByLabelText(/^Email/)[0]).toHaveValue('ana@example.com');
    expect(screen.getAllByLabelText(/First name/)[1]).toHaveValue('');
  });

  test('free order (lead): only the lead guest\'s first name is required', () => {
    render(
      <HolderForms holders={{ mode: 'optional', slots }} values={{}} onChange={() => {}}
        buyer={{}} error={null} lead />,
    );
    expect(screen.getByText('Lead guest')).toBeInTheDocument();
    expect(screen.getAllByLabelText(/First name/)[0]).toBeRequired();
    expect(screen.getAllByLabelText(/Last name/)[0]).not.toBeRequired();
    expect(screen.getAllByLabelText(/^Email/)[0]).not.toBeRequired();
    expect(screen.getAllByLabelText(/First name/)[1]).not.toBeRequired();
  });

  test('the payload: one entry per ticket, in order, blanks left out', () => {
    expect(holderPayload({ slots }, { 'seat:b': { firstName: ' Omar ', email: '' } })).toEqual([
      { key: 'seat:a', firstName: undefined, lastName: undefined, phone: undefined, email: undefined },
      { key: 'seat:b', firstName: 'Omar', lastName: undefined, phone: undefined, email: undefined },
    ]);
  });
});
