import { test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DateOnlyFields from '../src/app/organizer/events/new/DateOnlyFields';

/**
 * The date picker every display-only form shares: one date by default, a last
 * day only when asked for, and never a time.
 */
test('one date by default, a last day on request, and no time anywhere', async () => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  const { container } = render(<DateOnlyFields firstDay="2099-05-16" lastDay="" timezone="America/Toronto" onChange={onChange} />);

  expect(screen.getByLabelText(/^Date/)).toHaveAttribute('type', 'date');
  expect(screen.queryByLabelText(/Last day/)).not.toBeInTheDocument();
  expect(container.querySelector('input[type="datetime-local"], input[type="time"]')).toBeNull();

  await user.click(screen.getByRole('checkbox', { name: /more than one day/ }));
  expect(screen.getByLabelText(/First day/)).toBeInTheDocument();
  expect(screen.getByLabelText(/Last day/)).toHaveAttribute('min', '2099-05-16');

  await user.click(screen.getByRole('checkbox', { name: /more than one day/ }));
  expect(onChange).toHaveBeenLastCalledWith({ lastDay: '' });
});
