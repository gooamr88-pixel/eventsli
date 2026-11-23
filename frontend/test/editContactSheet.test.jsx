import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../src/app/utils/apiClient', () => ({ patch: vi.fn(), get: vi.fn() }));

import { patch } from '../src/app/utils/apiClient';
import EditContactSheet from '../src/app/organizer/events/[id]/orders/EditContactSheet';

const event = { timezone: 'America/Toronto', country: 'CA' };
const order = (over = {}) => ({
  id: 'a1b2c3d4-0000-4000-8000-000000000000', channel: 'stripe', status: 'paid', currency: 'CAD', tickets: 2,
  buyer: { name: 'Sara Ahmd', email: 'sara@gmial.com', phone: null, hasAccount: false },
  buyerPaidCents: 11300, createdAt: '2026-11-20T23:30:00Z', paidAt: '2026-11-20T23:31:00Z',
  ...over,
});

function setup(o = order()) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(<EditContactSheet eventId="ev1" event={event} order={o} onSaved={onSaved} onClose={onClose} />);
  return { onSaved, onClose, user: userEvent.setup() };
}

beforeEach(() => { patch.mockClear(); patch.mockImplementation(async () => ({})); });

describe('editing a buyer’s details', () => {
  it('opens on the order’s current details, with Save disabled until something changes', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Edit buyer details' })).toBeInTheDocument();
    expect(screen.getByText(/Order A1B2C3D4 · Card/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Name/)).toHaveValue('Sara Ahmd');
    expect(screen.getByLabelText(/^Email/)).toHaveValue('sara@gmial.com');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('a corrected email shows the old one and offers to send the tickets, ticked', async () => {
    const { user, onSaved } = setup();
    const email = screen.getByLabelText(/^Email/);
    await user.clear(email);
    await user.type(email, 'sara@gmail.com');
    expect(screen.getByText('Was sara@gmial.com')).toBeInTheDocument();
    const box = screen.getByRole('checkbox', { name: /Send the tickets to the new email/ });
    expect(box).toBeChecked();

    patch.mockResolvedValue({ changed: { email: true }, resent: true, order: { buyer: { email: 'sara@gmail.com' } } });
    await user.click(screen.getByRole('button', { name: 'Save and send tickets' }));
    expect(patch).toHaveBeenCalledWith('/events/ev1/orders/a1b2c3d4-0000-4000-8000-000000000000/contact', {
      name: 'Sara Ahmd', email: 'sara@gmail.com', phone: null, resend: true,
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it('unticking the box saves without sending', async () => {
    const { user } = setup();
    const email = screen.getByLabelText(/^Email/);
    await user.clear(email);
    await user.type(email, 'new@example.com');
    await user.click(screen.getByRole('checkbox', { name: /Send the tickets/ }));
    patch.mockResolvedValue({ changed: { email: true }, resent: false });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(patch.mock.calls[0][1].resend).toBe(false);
  });

  it('an unpaid order offers no re-send', async () => {
    const { user } = setup(order({ status: 'pending' }));
    const email = screen.getByLabelText(/^Email/);
    await user.clear(email);
    await user.type(email, 'x@example.com');
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText(/not paid, so there are no tickets to send/)).toBeInTheDocument();
  });

  it('says an account buyer keeps their account', () => {
    setup(order({ buyer: { name: 'Omar', email: 'o@acct.com', hasAccount: true } }));
    expect(screen.getByText(/their account stays as it is/)).toBeInTheDocument();
  });

  it('shows the server’s refusal and stays open', async () => {
    const { user, onSaved } = setup();
    const name = screen.getByLabelText(/^Name/);
    await user.clear(name);
    await user.type(name, 'Sara Ahmed');
    patch.mockImplementation(async () => {
      throw Object.assign(new Error('This order’s tickets were sent to an email address, so it needs one.'), { code: 'VALIDATION_ERROR', status: 400 });
    });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/needs one/);
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });
});
