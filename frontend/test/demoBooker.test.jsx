import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The "Book a demo" card (2026-11-19): a month → a day's times → the
 * details → booked. And the case that matters most: the time is taken
 * between choosing it and pressing Book — the card goes back to the times,
 * says so, and asks the API again.
 */
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../src/app/utils/apiClient', async (orig) => ({ ...(await orig()), get: api.get, post: api.post }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }) => <a href={href} {...rest}>{children}</a> }));

const { default: DemoBooker } = await import('../src/app/components/demo/DemoBooker');
const { ApiError } = await import('../src/app/utils/apiClient');
const { timeLabel, browserZone } = await import('../src/app/lib/demoTime');

const settings = {
  enabled: true, title: 'Book a demo', intro: '', confirmationMessage: 'Thanks — booked.',
  durationMinutes: 30, maxDaysAhead: 30, timezone: 'UTC', meetingNote: 'Link to follow.',
  contactPhone: '', contactEmail: 'info@eventsli.com',
  fields: {
    phone: { mode: 'hidden', label: 'Phone' },
    company: { mode: 'required', label: 'Your event' },
    topic: { mode: 'hidden', label: 'Topic' },
    message: { mode: 'hidden', label: 'Message' },
  },
  topics: [],
  questions: [{ id: 'size', label: 'Guests', type: 'select', options: ['Under 100', '100+'], required: true }],
};
const SLOTS = ['2026-11-23T14:00:00.000Z', '2026-11-23T14:30:00.000Z', '2026-11-25T10:00:00.000Z'];
// The card shows the runner's own zone (the browser's); every slot above stays on its UTC day from UTC-9 to UTC+9.
const ZONE = browserZone('UTC');
const at = (iso) => timeLabel(iso, ZONE);

function setup() {
  return render(
    <DemoBooker settings={settings} today="2026-11-19" initialMonth={{ year: 2026, month: 11 }} horizonDate="2026-12-19" />,
  );
}

async function toForm(user) {
  await user.click(await screen.findByRole('button', { name: /^23 November 2026, 2 open times/ }));
  await user.click(screen.getByRole('button', { name: at(SLOTS[1]) }));
  await user.click(screen.getByRole('button', { name: 'Select' }));
}

beforeEach(() => {
  api.get.mockReset().mockResolvedValue({ slots: SLOTS });
  api.post.mockReset();
});

describe('DemoBooker', () => {
  test('only days with open times are buttons', async () => {
    setup();
    expect(await screen.findByRole('button', { name: /^23 November 2026/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^25 November 2026, 1 open time$/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^24 November 2026/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeDisabled();
  });

  test('a time, then the form, then booked — with the visitor\'s zone and answers', async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue({
      booking: { id: 'b1', startsAt: SLOTS[1], endsAt: '2026-11-23T15:00:00.000Z' },
      token: 'x'.repeat(32),
    });
    setup();
    await toForm(user);
    await user.type(screen.getByLabelText(/Full name/), 'Ana');
    await user.type(screen.getByLabelText(/^Email/), 'ana@example.com');
    await user.type(screen.getByLabelText(/Your event/), 'Gala');
    await user.selectOptions(screen.getByLabelText(/Guests/), '100+');
    await user.click(screen.getByRole('button', { name: 'Book my demo' }));

    expect(api.post).toHaveBeenCalledWith('/public/demo/bookings', expect.objectContaining({
      startsAt: SLOTS[1], name: 'Ana', email: 'ana@example.com', company: 'Gala', answers: { size: '100+' },
      timezone: expect.any(String), website: '',
    }), expect.anything());
    expect(await screen.findByText('You’re booked')).toBeInTheDocument();
    expect(screen.getByText('Thanks — booked.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Change or cancel/ })).toHaveAttribute('href', `/demo/booking/b1?t=${'x'.repeat(32)}`);
  });

  test('taken in the meantime: back to the times, told why, asked again', async () => {
    const user = userEvent.setup();
    api.post.mockRejectedValue(new ApiError({ code: 'DEMO_SLOT_TAKEN', status: 409 }));
    setup();
    await toForm(user);
    await user.type(screen.getByLabelText(/Full name/), 'Ana');
    await user.type(screen.getByLabelText(/^Email/), 'ana@example.com');
    await user.type(screen.getByLabelText(/Your event/), 'Gala');
    await user.selectOptions(screen.getByLabelText(/Guests/), 'Under 100');
    api.get.mockResolvedValue({ slots: [SLOTS[0], SLOTS[2]] });
    await user.click(screen.getByRole('button', { name: 'Book my demo' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/just taken/i);
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: at(SLOTS[0]) })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: at(SLOTS[1]) })).toBeNull());
  });
});
