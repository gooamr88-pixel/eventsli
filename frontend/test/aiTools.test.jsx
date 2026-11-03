import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../src/app/utils/apiClient', () => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../src/app/organizer/events/[id]/EventContext', () => ({
  useEventContext: () => ({
    event: {
      id: 'e1', slug: 'neon-nights', title: 'Neon Nights', startsAt: '2026-11-15T02:00:00Z', timezone: 'America/Toronto',
      venue: { name: 'The Mod Club' }, city: 'Toronto', cover: null, highlights: ['Live DJ'],
    },
  }),
}));
// jsdom has no canvas; the drawing is pure and tested on its own terms.
vi.mock('../src/app/organizer/events/[id]/share/shareImage', async (orig) => ({
  ...(await orig()),
  drawShareImage: () => ({ toDataURL: () => 'data:image/jpeg;base64,AAAA' }),
  loadImage: async () => null,
}));
vi.mock('../src/app/components/ui/Toast', () => ({ useToast: () => ({ success: vi.fn(), show: vi.fn() }) }));

import { get, post } from '../src/app/utils/apiClient';
import SeatingDesigner, { DesignBanner } from '../src/app/organizer/events/[id]/map/SeatingDesigner';
import LaunchKit from '../src/app/organizer/events/[id]/share/LaunchKit';

/**
 * The two AI tools on a saved event, against a mocked API: the Seating
 * Designer proposes, shows what fits and applies only on the organizer's
 * word; the launch kit draws its images without AI and writes posts with it.
 */

const QUOTA = { enabled: true, limit: 2, used: 0, remaining: 2, nextAvailableAt: null };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  get.mockImplementation(async (p) => (p === '/ai/quota' ? QUOTA : {}));
  if (!globalThis.crypto?.randomUUID) globalThis.crypto = { ...globalThis.crypto, randomUUID: () => '00000000-0000-4000-8000-000000000000' };
});

describe('the Seating Designer', () => {
  const PLAN = {
    sections: [
      { name: 'VIP', tableCount: 4, seatsPerTable: 10, shape: 'round', area: 'front', ticketType: 'VIP', tableCategory: null },
      { name: 'Guests', tableCount: 60, seatsPerTable: 10, shape: 'round', area: 'anywhere', ticketType: null, tableCategory: null },
    ],
    zones: [{ kind: 'stage', label: null, position: 'front' }],
    summary: 'Four VIP tables at the front and sixty guest tables behind.',
  };

  test('plans, says what fits and what does not, and applies only when asked', async () => {
    post.mockResolvedValue({ plan: PLAN, quota: { ...QUOTA, used: 1, remaining: 1 } });
    const onApply = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<SeatingDesigner eventId="e1" tiers={[{ id: 't-vip', name: 'VIP' }]} categories={[]} replacing onApply={onApply} onClose={onClose} />);

    expect(screen.getByText(/replaces the tables and areas on your map/)).toBeInTheDocument();
    const go = screen.getByRole('button', { name: /Plan the room/ });
    expect(go).toBeDisabled();

    await user.type(screen.getByLabelText('Your room'), '640 guests at round tables of 10, VIP near the stage');
    await user.click(go);

    await waitFor(() => expect(post).toHaveBeenCalledWith(
      '/ai/events/e1/seating-plan',
      expect.objectContaining({ description: '640 guests at round tables of 10, VIP near the stage' }),
      { noRedirect: true },
    ));
    expect(await screen.findByText(/Four VIP tables at the front/)).toBeInTheDocument();
    expect(screen.getByText(/sold as “VIP”/)).toBeInTheDocument();
    expect(screen.getByText(/didn.t fit on the map/)).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Apply to map' }));
    const layout = onApply.mock.calls[0][0];
    expect(layout.tables[0]).toMatchObject({ label: 'VIP 1', tierId: 't-vip', seatCount: 10 });
    expect(layout.report.placed).toBeLessThan(64);
    expect(onClose).toHaveBeenCalled();
  });

  test('a refusal that cost nothing is said, and the plan is not applied', async () => {
    post.mockRejectedValue(Object.assign(new Error('That doesn’t describe a room. This did not use any of your daily drafts.'), { code: 'AI_NOT_A_ROOM' }));
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(<SeatingDesigner eventId="e1" tiers={[]} categories={[]} replacing={false} onApply={onApply} onClose={() => {}} />);
    await user.type(screen.getByLabelText('Your room'), 'Write me a poem about the sea please');
    await user.click(screen.getByRole('button', { name: /Plan the room/ }));
    expect(await screen.findByText(/did not use any of your daily drafts/)).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });
});

describe('the launch kit', () => {
  test('share images are offered without AI', async () => {
    get.mockImplementation(async (p) => (p === '/ai/quota' ? { ...QUOTA, enabled: false } : {}));
    render(<LaunchKit eventId="e1" shareEvent={{ url: 'https://eventsli.com/e/neon-nights' }} />);
    expect(await screen.findAllByRole('link', { name: /Download/ })).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: /Download/ })[0]).toHaveAttribute('download', 'neon-nights-post.jpg');
    expect(screen.queryByRole('button', { name: /Write my posts/ })).not.toBeInTheDocument();
  });

  test('posts are written per channel, with one-tap links to share them', async () => {
    post.mockResolvedValue({
      kit: {
        instagram: 'Neon Nights is coming.\nLink in bio.', facebook: 'Join us. https://eventsli.com/e/neon-nights?utm_source=facebook',
        whatsapp: 'Coming? https://eventsli.com/e/neon-nights?utm_source=whatsapp', x: 'Neon Nights → https://eventsli.com/e/neon-nights?utm_source=x',
        email: { subject: 'You are invited', body: 'Join us.\nhttps://eventsli.com/e/neon-nights?utm_source=email' },
        hashtags: ['#NeonNights'], taglines: ['One night. All neon.'], links: {},
      },
      quota: { ...QUOTA, used: 1, remaining: 1 },
    });
    const user = userEvent.setup();
    render(<LaunchKit eventId="e1" shareEvent={{ url: 'https://eventsli.com/e/neon-nights' }} />);
    await user.selectOptions(await screen.findByRole('combobox'), 'elegant');
    await user.click(screen.getByRole('button', { name: /Write my posts/ }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/ai/events/e1/launch-kit', expect.objectContaining({ tone: 'elegant' }), { noRedirect: true }));
    expect(await screen.findByText(/#NeonNights/)).toBeInTheDocument();
    const open = screen.getAllByRole('link', { name: /Open/ }).map((a) => a.getAttribute('href'));
    expect(open[0]).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(open[2]).toMatch(/^mailto:\?subject=You%20are%20invited/);
    expect(screen.getByRole('radio', { name: 'One night. All neon.' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('nothing paid for is lost', () => {
  const KIT = {
    instagram: 'Neon Nights.\nLink in bio.', facebook: 'Join us.', whatsapp: 'Coming?', x: 'Neon Nights',
    email: { subject: 'Invite', body: 'Join us.' }, hashtags: ['#NeonNights'], taglines: ['All neon.'], links: {},
  };

  test('a written launch kit is still there after a reload, without spending another draft', async () => {
    post.mockResolvedValue({ kit: KIT, quota: { ...QUOTA, remaining: 1 } });
    const user = userEvent.setup();
    const first = render(<LaunchKit eventId="e1" shareEvent={{ url: 'https://eventsli.com/e/neon-nights' }} />);
    await user.click(await screen.findByRole('button', { name: /Write my posts/ }));
    expect(await screen.findByText(/#NeonNights/)).toBeInTheDocument();
    first.unmount();

    post.mockClear();
    render(<LaunchKit eventId="e1" shareEvent={{ url: 'https://eventsli.com/e/neon-nights' }} />);
    expect(await screen.findByText(/#NeonNights/)).toBeInTheDocument();
    expect(screen.getByText(/kept in this browser/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Write again/ })).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  test('a seating plan not yet applied is still there when the designer is reopened', async () => {
    const PLAN = { sections: [{ name: 'Guests', tableCount: 4, seatsPerTable: 8, shape: 'round', area: 'anywhere', ticketType: null, tableCategory: null }], zones: [], summary: 'Four tables.' };
    post.mockResolvedValue({ plan: PLAN, quota: QUOTA });
    const user = userEvent.setup();
    const first = render(<SeatingDesigner eventId="e9" tiers={[]} categories={[]} replacing={false} onApply={() => {}} onClose={() => {}} />);
    await user.type(screen.getByLabelText('Your room'), '32 guests at round tables of eight');
    await user.click(screen.getByRole('button', { name: /Plan the room/ }));
    expect(await screen.findByText('Four tables.')).toBeInTheDocument();
    first.unmount();

    post.mockClear();
    render(<SeatingDesigner eventId="e9" tiers={[]} categories={[]} replacing={false} onApply={() => {}} onClose={() => {}} />);
    expect(screen.getByText('Four tables.')).toBeInTheDocument();
    expect(screen.getByText(/applying it again costs nothing/)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  test('when the designer cannot run, it says why instead of hiding', () => {
    render(<SeatingDesigner eventId="e1" tiers={[]} categories={[]} replacing blocked="3 seats are already held or sold on this map." onApply={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/3 seats are already held or sold/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Your room')).not.toBeInTheDocument();
  });
});

test('the way into the designer is a banner above the map, an invitation when the map is empty', async () => {
  const onOpen = vi.fn();
  const user = userEvent.setup();
  const { rerender } = render(<DesignBanner empty onOpen={onOpen} />);
  expect(screen.getByText('Describe your room and AI lays it out')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /Design with AI/ }));
  expect(onOpen).toHaveBeenCalledTimes(1);
  rerender(<DesignBanner empty={false} onOpen={onOpen} />);
  expect(screen.getByText(/Undo brings this one back/)).toBeInTheDocument();
});
