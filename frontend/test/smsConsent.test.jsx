import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SmsConsentFields, { smsPayload } from '../src/app/components/forms/SmsConsentFields';
import { CONSENT_TEXT, consentText } from '../src/app/lib/smsConsentText';
import { accountNavGroups } from '../src/app/account/nav/accountNav';

/**
 * SMS consent on the forms: the words match what the server records, nothing
 * is ticked for the person, and transactional and marketing are separate boxes.
 */

describe('the words on screen are the words on record', () => {
  test('every consent sentence matches backend/services/sms/consentText.js exactly', () => {
    const src = readFileSync(resolve(__dirname, '../../backend/services/sms/consentText.js'), 'utf8');
    const backend = {};
    for (const m of src.matchAll(/'([a-z_.]+\.v\d+)':\s*\n?\s*'([^']*)'/g)) backend[m[1]] = m[2];
    expect(Object.keys(backend).sort()).toEqual(Object.keys(CONSENT_TEXT).sort());
    for (const [k, v] of Object.entries(CONSENT_TEXT)) expect(backend[k], k).toBe(v);
  });
  test('the organizer is named in the organizer box', () => {
    expect(consentText('checkout.marketing_organizer.v1', { organizer: 'Jazz Club' })).toContain('from Jazz Club by text');
  });
});

function Harness({ mode = 'checkout', organizerName = 'Jazz Club', initialPhone = '' }) {
  const [value, setValue] = useState({});
  const [phone, setPhone] = useState(initialPhone);
  return (
    <>
      <SmsConsentFields mode={mode} value={value} onChange={setValue} phone={phone} onPhone={setPhone} showPhone={mode === 'checkout'} organizerName={organizerName} />
      <output data-testid="payload">{JSON.stringify(smsPayload(value, phone))}</output>
    </>
  );
}

describe('the consent fields', () => {
  test('checkout: no boxes until a number is typed, then three separate ones, none ticked', () => {
    // Owner, 2026-11-19: fewer things to approve. Boxes nobody could tick were
    // shown greyed out on every order; now they appear when they can be used.
    render(<Harness />);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    // The terms link stays in view: it is part of the disclosure.
    expect(screen.getByRole('link', { name: /text message terms/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Mobile number/), { target: { value: '+1 416 555 0199' } });
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(3);
    for (const b of boxes) {
      expect(b).not.toBeChecked();
      expect(b).toBeEnabled();
    }
  });

  test('registration still shows its boxes before a number, disabled', () => {
    render(<Harness mode="registration" />);
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    for (const b of boxes) expect(b).toBeDisabled();
  });

  test('only the ticked boxes are sent, and only with a number', () => {
    render(<Harness initialPhone="+1 416 555 0199" />);
    expect(screen.getByTestId('payload').textContent).toBe('{}');
    fireEvent.click(screen.getByLabelText(/ticket confirmation/));
    expect(JSON.parse(screen.getByTestId('payload').textContent)).toEqual({ sms: { transactional: true } });
    fireEvent.click(screen.getByLabelText(/from Jazz Club/));
    expect(JSON.parse(screen.getByTestId('payload').textContent)).toEqual({ sms: { transactional: true, marketingOrganizer: true } });
    expect(smsPayload({ transactional: true }, '')).toEqual({});
  });

  test('a box cannot stay ticked once the number is cleared, and the number is sent international', () => {
    render(<Harness initialPhone="+1 416 555 0199" />);
    fireEvent.click(screen.getByLabelText(/ticket confirmation/));
    fireEvent.change(screen.getByLabelText(/Mobile number/), { target: { value: '' } });
    expect(screen.queryByLabelText(/ticket confirmation/)).toBeNull();
    expect(screen.getByTestId('payload').textContent).toBe('{}');
    // Typing a number again brings the boxes back UNticked: the earlier tick
    // was cleared with the number, never silently carried over.
    fireEvent.change(screen.getByLabelText(/Mobile number/), { target: { value: '+1 416 555 0199' } });
    expect(screen.getByLabelText(/ticket confirmation/)).not.toBeChecked();
    // The flag picker (2026-11-19): a pasted "+1 …" picks the country, and the
    // box keeps only the national number; letters never reach the value.
    expect(screen.getByLabelText(/Mobile number/)).toHaveValue('416 555 0199');
    expect(screen.getByRole('button', { name: /Country: Canada, \+1/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Mobile number/), { target: { value: 'call me' } });
    expect(screen.getByTestId('payload').textContent).toBe('{}');
  });

  test('no organizer, no organizer box; registration asks two questions', () => {
    const { unmount } = render(<Harness organizerName={null} initialPhone="+1 416 555 0199" />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    unmount();
    render(<Harness mode="registration" initialPhone="+1 416 555 0199" />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.queryByLabelText(/Mobile number/)).toBeNull();
  });
});

test('the account workspace links to text message preferences', () => {
  const hrefs = accountNavGroups().flatMap((g) => g.items.map((i) => i.href));
  expect(hrefs).toContain('/account/messages');
});
