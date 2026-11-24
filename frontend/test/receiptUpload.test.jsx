import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/** Proof of payment on the buyer's page (2026-11-24): sign, upload, record. */
const api = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../src/app/utils/apiClient', () => api);

import ReceiptUpload from '../src/app/checkout/offline/[id]/ReceiptUpload';

beforeEach(() => {
  api.post.mockReset();
  globalThis.fetch = vi.fn(async () => ({ ok: true }));
});

const file = (type, size = 1000) => {
  const f = new File(['x'], 'receipt', { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};
const choose = (f) => fireEvent.change(document.getElementById('receipt-file'), { target: { files: [f] } });

describe('the receipt upload', () => {
  it('signs, uploads the file straight to storage, then records it', async () => {
    api.post
      .mockResolvedValueOnce({ uploadUrl: 'https://storage.test/up', path: 'offline/p1/proof-1.png' })
      .mockResolvedValueOnce({ id: 'p1', proof: { uploadedAt: '2026-11-24T10:00:00Z' } });
    const onUploaded = vi.fn();
    render(<ReceiptUpload id="p1" token="tok" proof={null} timezone="Africa/Cairo" onUploaded={onUploaded} />);
    choose(file('image/png'));
    await waitFor(() => expect(onUploaded).toHaveBeenCalled());
    expect(api.post.mock.calls[0]).toEqual(['/public/offline-payments/p1/proof/sign?token=tok', { contentType: 'image/png' }, expect.anything()]);
    expect(globalThis.fetch).toHaveBeenCalledWith('https://storage.test/up', expect.objectContaining({ method: 'PUT' }));
    expect(api.post.mock.calls[1]).toEqual(['/public/offline-payments/p1/proof?token=tok', { path: 'offline/p1/proof-1.png' }, expect.anything()]);
  });

  it('refuses a file that is not a photo or PDF, or is over 10 MB, before uploading anything', async () => {
    render(<ReceiptUpload id="p1" token="tok" proof={null} timezone="Africa/Cairo" />);
    choose(file('text/html'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/photo|PDF/);
    choose(file('image/jpeg', 11 * 1024 * 1024));
    expect(await screen.findByRole('alert')).toHaveTextContent(/10 MB/);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('once sent, says so and offers to replace it', () => {
    render(<ReceiptUpload id="p1" token="tok" proof={{ uploadedAt: '2026-11-24T10:00:00Z' }} timezone="Africa/Cairo" />);
    expect(screen.getByText(/Receipt sent to the organizer/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Replace the receipt/ })).toBeInTheDocument();
  });
});
