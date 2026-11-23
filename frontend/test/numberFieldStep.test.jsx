import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NumberField } from '../src/app/components/inspector/fields';
import BoothRowDialog from '../src/app/organizer/events/[id]/map/BoothRowDialog';

/**
 * The map editors' number field and the browser must agree on what a valid
 * value is (2026-11-23). The field snaps to whole steps from ZERO; the browser
 * counts steps from `min`. With min 0.2 and step 0.5 the booth-row dialog
 * refused a width of exactly 3 m — "the two nearest valid values are 2.7 and
 * 3.2" — and would not submit.
 */
function Host(props) {
  return <form aria-label="host"><NumberField label="Width" value={3} onChange={() => {}} {...props} /></form>;
}

describe('NumberField bounds sit on the step', () => {
  it('moves an off-step min and max onto the step, so whole steps are valid', () => {
    render(<Host min={0.2} max={60.3} step={0.5} />);
    const input = screen.getByLabelText('Width');
    expect(input).toHaveAttribute('min', '0.5');
    expect(input).toHaveAttribute('max', '60');
    expect(input.validity.valid).toBe(true);
    expect(screen.getByRole('form', { name: 'host' }).checkValidity()).toBe(true);
  });

  it('leaves bounds already on the step alone', () => {
    render(<Host min={0} max={20} step={0.5} />);
    const input = screen.getByLabelText('Width');
    expect(input).toHaveAttribute('min', '0');
    expect(input).toHaveAttribute('max', '20');
  });

  it('snaps an off-step entry on blur instead of leaving it invalid', async () => {
    const onChange = vi.fn();
    render(<Host min={0.2} max={60} step={0.5} onChange={onChange} />);
    const input = screen.getByLabelText('Width');
    const user = userEvent.setup();
    await user.clear(input);
    await user.type(input, '3.3');
    fireEvent.blur(input);
    expect(input).toHaveValue(3.5);
    expect(onChange).toHaveBeenLastCalledWith(3.5);
    expect(input.validity.valid).toBe(true);
  });
});

describe('the booth-row dialog', () => {
  it('opens valid with its defaults — 6 booths, 3 m by 3 m — and adds them', async () => {
    const onAdd = vi.fn();
    render(<BoothRowDialog zones={[]} placeAt={() => ({ x: 50, y: 50 })} onAdd={onAdd} onClose={() => {}} />);
    const form = screen.getByRole('dialog');
    expect(form.checkValidity()).toBe(true);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Add to map' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0]).toHaveLength(6);
  });
});
