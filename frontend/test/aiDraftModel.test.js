import { describe, test, expect } from 'vitest';
import {
  priceToCents, centsToPrice, formFromDraft, problemsFor, savePlan, laterNeeds, newTier,
} from '../src/app/organizer/events/new/ai/aiDraftModel';
import { RESULT } from './aiDraftFixture';

/**
 * The Smart Event Creator's draft, without a screen: what the API's answer
 * becomes, what stops "Save draft", and the exact requests that save it.
 */

const ORGANIZER = { country: 'CA', payments: { choices: ['manual'] } };
const NOW = new Date('2026-10-18T12:00:00Z');

describe('money as text', () => {
  test('prices are parsed without floating point', () => {
    expect(priceToCents('95')).toBe(9500);
    expect(priceToCents('19.99')).toBe(1999);
    expect(priceToCents('$1,250.5')).toBe(125050);
    expect(priceToCents('0')).toBe(0);
    expect(priceToCents('')).toBe(null);
    expect(priceToCents('abc')).toBe(null);
    expect(priceToCents('9.999')).toBe(null);
    expect(centsToPrice(9550)).toBe('95.50');
    expect(centsToPrice(null)).toBe('');
  });
});

describe('the draft as a form', () => {
  test('times are shown on the venue’s clock, and the AI never sets a map pin', () => {
    const form = formFromDraft(RESULT, ORGANIZER);
    expect(form.startsAt).toBe('2026-11-07T18:30');
    expect(form.endsAt).toBe('');
    expect(form.startEvidence).toBe('Saturday November 7 from 6:30pm');
    expect([form.venueLat, form.venueLng, form.venuePlaceId]).toEqual(['', '', '']);
    expect(form.tiers.map((t) => t.price)).toEqual(['95.00', '']);
    expect(form.paymentOption).toBe('manual');
    expect(form.feeBearer).toBe('buyer');
  });

  test('a missing end and an unpriced ticket are the two things that block saving', () => {
    const form = formFromDraft(RESULT, ORGANIZER);
    const problems = problemsFor(form, NOW);
    expect(problems.map((p) => p.field)).toEqual(['endsAt', `tier-${form.tiers[1].key}-price`]);
    expect(problems.map((p) => p.section)).toEqual(['when', 'tickets']);
  });

  test('D-018: an unpriced ticket is resolved by a price, by "free", or by removing it — nothing else', () => {
    const base = { ...formFromDraft(RESULT, ORGANIZER), endsAt: '2026-11-07T23:30' };
    const child = base.tiers[1];
    expect(problemsFor(base, NOW)).toHaveLength(1);
    expect(problemsFor({ ...base, tiers: [base.tiers[0], { ...child, price: '45' }] }, NOW)).toEqual([]);
    expect(problemsFor({ ...base, tiers: [base.tiers[0], { ...child, free: true }] }, NOW)).toEqual([]);
    expect(problemsFor({ ...base, tiers: [base.tiers[0]] }, NOW)).toEqual([]);
    expect(problemsFor({ ...base, tiers: [base.tiers[0], { ...child, price: 'forty' }] }, NOW)[0].message).toMatch(/as a number/);
  });

  test('a missing venue never blocks a draft; it is needed only to submit', () => {
    const form = { ...formFromDraft(RESULT, ORGANIZER), endsAt: '2026-11-07T23:30', venueName: '', venueAddress: '', city: '', tiers: [] };
    expect(problemsFor(form, NOW)).toEqual([]);
    expect(laterNeeds(form)).toEqual(['the venue name', 'the street address', 'the city']);
  });

  test('a display-only listing has no ticket problems, whatever the tiers say', () => {
    const form = { ...formFromDraft(RESULT, ORGANIZER), listingType: 'display_only', endsAt: '2026-11-07T23:30' };
    expect(problemsFor(form, NOW)).toEqual([]);
  });

  test('two ticket types with one name are refused before the API refuses them', () => {
    const form = { ...formFromDraft(RESULT, ORGANIZER), endsAt: '2026-11-07T23:30' };
    form.tiers = [form.tiers[0], { ...newTier(), name: 'general', price: '10' }];
    expect(problemsFor(form, NOW)[0].message).toMatch(/two ticket types/);
  });
});

describe('saving', () => {
  const ready = () => {
    const form = formFromDraft(RESULT, ORGANIZER);
    return { ...form, endsAt: '2026-11-07T23:30', tiers: [form.tiers[0], { ...form.tiers[1], free: true }] };
  };

  test('the event is a private draft with no money settings beyond the organizer’s own', () => {
    const { event } = savePlan(ready(), ['manual']);
    expect(event).toMatchObject({
      title: 'Diwali Gala Dinner 2026', startsAt: '2026-11-07T23:30:00.000Z', endsAt: '2026-11-08T04:30:00.000Z',
      admissionType: 'reserved', purchaseMode: 'seat_and_table', feeBearer: 'buyer', paymentOption: 'manual',
      aiGenerationId: 'gen-1', venueName: 'Palais Royale', city: 'Toronto',
    });
    for (const k of ['status', 'commissionPct', 'paymentFeePct', 'currency', 'venueLat']) expect(event).not.toHaveProperty(k);
  });

  test('a payment option the organizer has not set up is not sent', () => {
    expect(savePlan(ready(), []).event).not.toHaveProperty('paymentOption');
  });

  test('ticket types are integer cents in the order shown; free is zero', () => {
    const { tiers } = savePlan(ready(), ['manual']);
    expect(tiers.map((t) => t.body)).toEqual([
      { name: 'General', kind: 'standard', priceCents: 9500, sortOrder: 0, description: 'Seat and dinner' },
      { name: 'Child (under 12)', kind: 'standard', priceCents: 0, sortOrder: 1 },
    ]);
  });

  test('a quantity is sent only for general admission', () => {
    const ga = { ...ready(), admissionType: 'general', tiers: [{ ...ready().tiers[0], quantity: '300' }] };
    expect(savePlan(ga, []).tiers[0].body.quantity).toBe(300);
    const reserved = { ...ready(), tiers: [{ ...ready().tiers[0], quantity: '300' }] };
    expect(savePlan(reserved, []).tiers[0].body).not.toHaveProperty('quantity');
  });

  test('schedule times go as instants in the event’s zone; highlights go as a list', () => {
    const plan = savePlan(ready(), []);
    expect(plan.schedule[0].body).toEqual({ title: 'Doors open', startsAt: '2026-11-07T23:30:00.000Z' });
    expect(plan.highlights).toEqual(['Three-course dinner', 'Live Bollywood band']);
  });

  test('a display-only listing saves no ticket types', () => {
    const listing = { ...ready(), listingType: 'display_only' };
    const plan = savePlan(listing, ['manual']);
    expect(plan.tiers).toEqual([]);
    expect(plan.event).not.toHaveProperty('admissionType');
    expect(plan.event).not.toHaveProperty('paymentOption');
  });
});
