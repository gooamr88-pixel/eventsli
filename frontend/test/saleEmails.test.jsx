import { test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const put = vi.fn();
vi.mock('../src/app/utils/apiClient', () => ({ put: (...a) => put(...a) }));
let data = null;
vi.mock('../src/app/hooks/useApi', () => ({ useApi: () => ({ data, error: null, loading: false, reload: vi.fn() }) }));
vi.mock('../src/app/components/ui/Toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

const { default: SaleEmails } = await import('../src/app/organizer/profile/SaleEmails');

/** The organizer's sale emails (2026-11-23): when, and to whom. */
beforeEach(() => {
  put.mockReset();
  data = { mode: 'each', toOwner: true, ownerEmail: 'owner@org.test', recipients: [], maxRecipients: 5 };
});

test('every sale by default, to the owner; adding a box office and choosing the summary saves both', async () => {
  put.mockResolvedValue({});
  const user = userEvent.setup();
  render(<SaleEmails />);
  expect(screen.getByRole('radio', { name: /Every sale/ })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: /owner@org.test/ })).toBeChecked();
  expect(screen.getByRole('button', { name: /Save/ })).toBeDisabled();

  await user.click(screen.getByRole('radio', { name: /Daily summary/ }));
  await user.type(screen.getByRole('textbox', { name: 'Add an email address' }), 'Box@Office.test{Enter}');
  expect(screen.getByText('box@office.test')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /Save/ }));
  expect(put).toHaveBeenCalledWith('/organizer/sale-emails', { mode: 'daily', toOwner: true, recipients: ['box@office.test'] }, { noRedirect: true });
});

test('a bad address is refused on the spot; nobody to send to blocks saving', async () => {
  const user = userEvent.setup();
  render(<SaleEmails />);
  await user.type(screen.getByRole('textbox', { name: 'Add an email address' }), 'nope{Enter}');
  expect(screen.getByText('That is not an email address.')).toBeInTheDocument();

  await user.click(screen.getByRole('checkbox', { name: /owner@org.test/ }));
  expect(screen.getByText(/Nobody would receive them/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Save/ })).toBeDisabled();
});

test('off hides the recipients', async () => {
  const user = userEvent.setup();
  render(<SaleEmails />);
  await user.click(screen.getByRole('radio', { name: /^Off/ }));
  expect(screen.queryByRole('checkbox', { name: /owner@org.test/ })).toBeNull();
});
