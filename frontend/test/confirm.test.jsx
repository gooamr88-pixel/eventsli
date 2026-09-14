import { describe, test, expect } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider, useConfirm } from '../src/app/components/ui/Confirm';

/**
 * Every destructive admin action requires a reason for the audit log. The dialog
 * must not let one through without it, and must report a cancel as a cancel.
 */
function Harness({ reason }) {
  const confirm = useConfirm();
  const [answer, setAnswer] = useState('pending');
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          const result = await confirm({
            title: 'Cancel this event?',
            confirmLabel: 'Cancel the event',
            tone: 'danger',
            reason,
          });
          setAnswer(result ? `ok:${result.reason}` : 'cancelled');
        }}
      >
        open
      </button>
      <output>{answer}</output>
    </>
  );
}

const renderHarness = (reason) => render(
  <ConfirmProvider><Harness reason={reason} /></ConfirmProvider>,
);

describe('useConfirm', () => {
  test('the confirm button stays disabled until the reason is long enough', async () => {
    const user = userEvent.setup();
    renderHarness({ label: 'Why?', minLength: 10 });

    await user.click(screen.getByText('open'));
    const confirmButton = screen.getByRole('button', { name: 'Cancel the event', hidden: true });
    expect(confirmButton).toBeDisabled();

    await user.type(screen.getByLabelText('Why?'), 'too short');
    expect(confirmButton).toBeDisabled();

    await user.type(screen.getByLabelText('Why?'), ' — now it is long enough');
    expect(confirmButton).toBeEnabled();

    await user.click(confirmButton);
    expect(await screen.findByText('ok:too short — now it is long enough')).toBeInTheDocument();
  });

  test('cancelling resolves null, and nothing proceeds', async () => {
    const user = userEvent.setup();
    renderHarness(null);
    await user.click(screen.getByText('open'));
    await user.click(screen.getByRole('button', { name: 'Cancel', hidden: true }));
    expect(await screen.findByText('cancelled')).toBeInTheDocument();
  });

  test('without a provider, a confirmation is refused rather than assumed', async () => {
    const user = userEvent.setup();
    render(<Harness reason={null} />);
    await user.click(screen.getByText('open'));
    expect(await screen.findByText('cancelled')).toBeInTheDocument();
  });
});
