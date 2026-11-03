import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('../src/app/utils/apiClient', () => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn() }));
// jsdom has no canvas: the decode-and-downscale step is replaced, and the
// pure helpers beside it are tested for real below.
vi.mock('../src/app/organizer/events/new/ai/posterImage', async (importOriginal) => ({
  ...(await importOriginal()),
  preparePoster: vi.fn(),
}));

import { get, post, put } from '../src/app/utils/apiClient';
import AiCreator from '../src/app/organizer/events/new/ai/AiCreator';
import { TypeChooser } from '../src/app/organizer/events/new/WizardParts';
import { resetCategoriesForTests } from '../src/app/hooks/useCategories';
import {
  preparePoster, fitWithin, posterFileProblem, base64Of, bytesOfBase64, POSTER_KEY,
} from '../src/app/organizer/events/new/ai/posterImage';
import { formFromDraft, savePlan } from '../src/app/organizer/events/new/ai/aiDraftModel';
import { saveAiDraft } from '../src/app/organizer/events/new/ai/saveAiDraft';
import { uploadEventCover } from '../src/app/utils/uploadEventImage';
import { RESULT } from './aiDraftFixture';

/**
 * Drafting an event from a poster, in the browser.
 *
 * What these pin: the poster is offered only when the API says it can read
 * one; nothing is sent until there is a poster and Generate is pressed; the
 * poster goes to its own endpoint as base64, never a URL; the review shows the
 * poster as the cover with what was read off it; and saving uploads it as the
 * cover through the ordinary three-step cover upload, named and retryable on
 * its own when it fails.
 */

const ORGANIZER = { country: 'CA', payments: { choices: ['manual'] } };
const QUOTA = { enabled: true, poster: true, limit: 2, used: 0, remaining: 2, nextAvailableAt: null };
const POSTER = { dataUrl: 'data:image/jpeg;base64,QUJDRA==', width: 1200, height: 1600, bytes: 4, name: 'neon-nights.jpg' };
const POSTER_RESULT = { ...RESULT, source: 'poster', posterText: 'NEON NIGHTS\nSATURDAY NOVEMBER 7' };

function api({ quota = QUOTA } = {}) {
  get.mockImplementation(async (path) => {
    if (path === '/ai/quota') return quota;
    if (path.startsWith('/public/event-categories')) return { labelled: [{ slug: 'gala', label: 'Galas & banquets' }, { slug: 'other', label: 'Everything else' }] };
    return {};
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetCategoriesForTests();
  sessionStorage.clear();
  if (!globalThis.crypto?.randomUUID) globalThis.crypto = { ...globalThis.crypto, randomUUID: () => '00000000-0000-4000-8000-000000000000' };
  window.scrollTo = () => {};
});

describe('the poster, prepared in the browser', () => {
  test('the long side is brought to 1600 px and never enlarged', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(1080, 1350)).toEqual({ width: 1080, height: 1350 });
    expect(fitWithin(3000, 6000, 1200)).toEqual({ width: 600, height: 1200 });
  });

  test('only an image of a usable kind and size is taken', () => {
    expect(posterFileProblem(null)).toMatch(/Choose an image/);
    expect(posterFileProblem({ type: 'application/pdf', name: 'a.pdf', size: 10 })).toMatch(/not an image/);
    expect(posterFileProblem({ type: 'image/svg+xml', name: 'a.svg', size: 10 })).toMatch(/JPEG, PNG or WebP/);
    expect(posterFileProblem({ type: 'image/jpeg', name: 'a.jpg', size: 30 * 1048576 })).toMatch(/under 25 MB/);
    expect(posterFileProblem({ type: '', name: 'IMG_0042.HEIC', size: 2e6 })).toBeNull();
    expect(posterFileProblem({ type: 'image/png', name: 'flyer.png', size: 2e6 })).toBeNull();
  });

  test('base64 is taken from a data URL and measured without decoding', () => {
    expect(base64Of(POSTER.dataUrl)).toBe('QUJDRA==');
    expect(base64Of('not a data url')).toBe('');
    expect(bytesOfBase64('QUJDRA==')).toBe(4);
  });
});

describe('the draft and its save', () => {
  test('a poster draft keeps the poster as the cover unless the organizer says no', () => {
    const form = formFromDraft(POSTER_RESULT, ORGANIZER);
    expect(form).toMatchObject({ source: 'poster', useAsCover: true, posterText: POSTER_RESULT.posterText });
    expect(savePlan(form, [], POSTER).cover).toBe(POSTER.dataUrl);
    expect(savePlan({ ...form, useAsCover: false }, [], POSTER).cover).toBeNull();
    expect(savePlan(form, [], null).cover, 'the poster was lost on reload').toBeNull();
    expect(formFromDraft(RESULT, ORGANIZER)).toMatchObject({ source: 'text', useAsCover: false });
  });

  test('the cover is uploaded in three steps: a signed URL, the bytes, then the confirm', async () => {
    const calls = [];
    post.mockImplementation(async (path, body) => { calls.push(['post', path, body]); return { uploadUrl: 'https://storage.test/put', path: 'events/e1/cover-x.jpg', maxBytes: 5 * 1048576 }; });
    put.mockImplementation(async (path, body) => { calls.push(['put', path, body]); return { id: 'e1' }; });
    globalThis.fetch = vi.fn(async (url, init) => { calls.push(['fetch', url, init.method]); return { ok: true }; });

    await uploadEventCover('e1', new Blob(['x'], { type: 'image/jpeg' }));
    expect(calls).toEqual([
      ['post', '/events/e1/cover-upload', { contentType: 'image/jpeg' }],
      ['fetch', 'https://storage.test/put', 'PUT'],
      ['put', '/events/e1/cover', { path: 'events/e1/cover-x.jpg' }],
    ]);
  });

  test('a cover that fails to upload is named, and retrying sends only the cover', async () => {
    const plan = savePlan(formFromDraft(POSTER_RESULT, ORGANIZER), ['manual'], POSTER);
    post.mockImplementation(async (path) => {
      if (path === '/events') return { id: 'evt-9' };
      if (path.endsWith('/cover-upload')) return { uploadUrl: 'https://storage.test/put', path: 'events/evt-9/c.jpg', maxBytes: 5e6 };
      return {};
    });
    globalThis.fetch = vi.fn(async () => ({ ok: false }));

    const first = await saveAiDraft(plan);
    expect(first.eventId).toBe('evt-9');
    expect(first.failed.map((f) => f.key)).toEqual(['cover']);
    expect(first.failed[0].label).toMatch(/your poster/);

    globalThis.fetch = vi.fn(async () => ({ ok: true }));
    put.mockResolvedValue({ id: 'evt-9' });
    post.mockClear();
    const again = await saveAiDraft(plan, { eventId: 'evt-9', only: ['cover'] });
    expect(again.failed).toEqual([]);
    expect(post.mock.calls.map(([p]) => p)).toEqual(['/events/evt-9/cover-upload'], 'no event, tier or schedule re-sent');
  });
});

describe('the screens', () => {
  test('the entry card offers the poster only when the API can read one', async () => {
    api();
    const { unmount } = render(<TypeChooser />);
    expect(await screen.findByRole('link', { name: /Upload your poster, and we.ll draft it/ })).toBeInTheDocument();
    unmount();
    api({ quota: { ...QUOTA, poster: false } });
    render(<TypeChooser />);
    expect(await screen.findByRole('link', { name: /Describe it, and we.ll draft it/ })).toBeInTheDocument();
  });

  test('without poster support the describe screen is exactly the text box it was', async () => {
    api({ quota: { ...QUOTA, poster: false } });
    render(<AiCreator organizer={ORGANIZER} />);
    expect(await screen.findByLabelText('About your event')).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /From a poster/ })).not.toBeInTheDocument();
  });

  test('Generate waits for a poster, then sends it — as base64, with the note — to its own endpoint', async () => {
    api();
    preparePoster.mockResolvedValue(POSTER);
    post.mockResolvedValue(POSTER_RESULT);
    const user = userEvent.setup();
    render(<AiCreator organizer={ORGANIZER} />);

    expect(await screen.findByRole('radio', { name: /From a poster/ })).toBeChecked();
    await user.click(screen.getByRole('button', { name: /Generate draft/ }));
    expect(screen.getByText('Add the poster first.')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();

    const file = new File(['poster'], 'neon-nights.jpg', { type: 'image/jpeg' });
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });
    expect(await screen.findByAltText('Your poster')).toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem(POSTER_KEY)).name, 'kept for a reload').toBe('neon-nights.jpg');

    await user.type(screen.getByLabelText(/Anything the poster doesn.t say/), 'Students $15');
    await user.click(screen.getByRole('button', { name: /Generate draft/ }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [path, body] = post.mock.calls[0];
    expect(path).toBe('/ai/event-drafts/from-image');
    expect(body).toMatchObject({ listingType: 'ticketed', country: 'CA', notes: 'Students $15', image: { mimeType: 'image/jpeg', data: 'QUJDRA==' } });
    expect(body).not.toHaveProperty('description');

    // The review: the poster is the cover, with what was read off it.
    expect(await screen.findByRole('checkbox', { name: /Use this poster as the event.s cover/ })).toBeChecked();
    expect(screen.getByText(/What we read on your poster/)).toBeInTheDocument();
    expect(screen.getAllByText(/Built from your poster/).length).toBeGreaterThan(0);
  });

  test('an image that is not an event says so, and that it cost nothing', async () => {
    api();
    sessionStorage.setItem(POSTER_KEY, JSON.stringify(POSTER));
    post.mockRejectedValueOnce(Object.assign(new Error('We couldn’t find event details in that image. This did not use any of your daily drafts.'), { code: 'AI_NOT_AN_EVENT' }));
    const user = userEvent.setup();
    render(<AiCreator organizer={ORGANIZER} />);
    await screen.findByAltText('Your poster');
    await user.click(screen.getByRole('button', { name: /Generate draft/ }));
    expect(await screen.findByText(/couldn.t find an event in that image/)).toBeInTheDocument();
    expect(screen.getByText(/did not use any of your daily drafts/)).toBeInTheDocument();
    expect(screen.getByAltText('Your poster'), 'the poster stays, ready to replace').toBeInTheDocument();
  });
});
