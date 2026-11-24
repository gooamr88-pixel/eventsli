import { describe, test, expect } from 'vitest';
import { namedTierColour, tierPalette, tableTint, NAMED_TIER_COLOURS } from '../src/app/components/venue/venueModel';

/** Default colours by name (owner, 2026-11-24): VIP red, Gold, Silver, Bronze, VVIP blue. */
const colour = (key) => NAMED_TIER_COLOURS.find((c) => c.key === key).colour;

describe('named tier colours', () => {
  test('each name finds its colour, VVIP before VIP, whole words only', () => {
    expect(namedTierColour('VIP')).toBe(colour('vip'));
    expect(namedTierColour('VIP Table 4')).toBe(colour('vip'));
    expect(namedTierColour('VVIP')).toBe(colour('vvip'));
    expect(namedTierColour('Gold Circle')).toBe(colour('gold'));
    expect(namedTierColour('Silver')).toBe(colour('silver'));
    expect(namedTierColour('bronze seats')).toBe(colour('bronze'));
    expect(namedTierColour('طاولة ذهبية')).toBe(colour('gold'));
    expect(namedTierColour('Vipassana night')).toBeNull();
    expect(namedTierColour('General admission')).toBeNull();
  });

  test('the palette gives named types their colour and the rest something else', () => {
    const tiers = [
      { id: 'a', name: 'VIP', priceCents: 30000 },
      { id: 'b', name: 'Gold', priceCents: 20000 },
      { id: 'c', name: 'Standard', priceCents: 5000 },
      { id: 'd', name: 'VVIP', priceCents: 50000 },
    ];
    const p = tierPalette(tiers, []);
    expect(p.get('a')).toBe(colour('vip'));
    expect(p.get('b')).toBe(colour('gold'));
    expect(p.get('d')).toBe(colour('vvip'));
    expect([colour('vip'), colour('gold'), colour('vvip')]).not.toContain(p.get('c'));
  });

  test('a map of only VIP tables still paints them red', () => {
    const tint = tableTint({ tiers: [{ id: 'v', name: 'VIP' }], tables: [{ id: 't1', tierId: 'v' }, { id: 't2', tierId: 'v' }] });
    expect(tint({ id: 't1', tierId: 'v' })).toBe(colour('vip'));
    const plain = tableTint({ tiers: [{ id: 's', name: 'Standard' }], tables: [{ id: 't1', tierId: 's' }] });
    expect(plain({ id: 't1', tierId: 's' })).toBeNull();
  });
});
