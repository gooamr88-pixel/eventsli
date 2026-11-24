import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AmPmCheck, { amPmSlip } from '../src/app/components/forms/AmPmCheck';

/** The Adel event's slip (2026-11-24): 8:30 AM to 1:00 AM was meant as 8:30 PM. */
describe('did you mean PM?', () => {
  test('a morning start that runs past midnight is flagged, with the PM time', () => {
    expect(amPmSlip('2026-12-11T08:30', '2026-12-12T01:00')).toMatchObject({ value: '2026-12-11T20:30', label: '8:30 PM' });
  });

  test('an evening event, a day event and a short morning one are left alone', () => {
    expect(amPmSlip('2026-12-11T20:30', '2026-12-12T01:00')).toBeNull();
    expect(amPmSlip('2026-12-11T09:00', '2026-12-11T17:00')).toBeNull();
    expect(amPmSlip('2026-12-11T00:30', '2026-12-11T04:00')).toBeNull();
  });

  test('one tap moves the start to the evening', async () => {
    const onFix = vi.fn();
    render(<AmPmCheck start="2026-12-11T08:30" end="2026-12-12T01:00" onFix={onFix} />);
    await userEvent.click(screen.getByRole('button', { name: 'Change to 8:30 PM' }));
    expect(onFix).toHaveBeenCalledWith('2026-12-11T20:30');
  });
});
