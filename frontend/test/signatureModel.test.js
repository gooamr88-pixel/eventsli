import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  boxHeight, measure, signatureState, toPayload, BOX_W, MIN_H, MAX_H, MIN_INK, MIN_SPAN, MAX_STROKES, MAX_POINTS,
} from '../src/app/checkout/[reservationId]/signatureModel';

/**
 * The checkout signature's rules, on the browser side. The button lights only
 * when the API will accept what was drawn, so these must be the API's numbers
 * — the last test reads the backend's service off disk and holds them equal.
 */
const wave = (n = 40) => Array.from({ length: n }, (_, i) => [100 + i * 18, 150 + Math.sin(i / 3) * 60]).flat();

describe('signature state', () => {
  it('is empty with nothing drawn or typed', () => {
    expect(signatureState(null)).toBe('empty');
    expect(signatureState({ method: 'drawn', height: 400, strokes: [] })).toBe('empty');
    expect(signatureState({ method: 'typed', name: '   ' })).toBe('empty');
  });

  it('is too small for a tap or a dash, and ready for a real signature', () => {
    expect(signatureState({ method: 'drawn', height: 400, strokes: [[500, 200]] })).toBe('small');
    expect(signatureState({ method: 'drawn', height: 400, strokes: [[500, 200, 540, 200]] })).toBe('small');
    expect(signatureState({ method: 'drawn', height: 400, strokes: [wave()] })).toBe('ready');
  });

  it('takes a typed name of two characters or more', () => {
    expect(signatureState({ method: 'typed', name: 'A' })).toBe('small');
    expect(signatureState({ method: 'typed', name: 'Mona Adel' })).toBe('ready');
  });
});

describe('what is sent', () => {
  it('rounds points to a tenth in the fixed 1000-wide box', () => {
    const out = toPayload({ method: 'drawn', height: 400, strokes: [[10.04, 20.06, 30, 40]] });
    expect(out).toEqual({ method: 'drawn', width: BOX_W, height: 400, strokes: [[10, 20.1, 30, 40]] });
  });

  it('tidies a typed name', () => {
    expect(toPayload({ method: 'typed', name: '  Mona   Adel ' })).toEqual({ method: 'typed', name: 'Mona Adel' });
  });

  it('sizes the box from the pad and keeps it inside the limits', () => {
    expect(boxHeight(500, 200)).toBe(400);
    expect(boxHeight(1000, 50)).toBe(MIN_H);
    expect(boxHeight(300, 900)).toBe(MAX_H);
  });

  it('measures pen travel and span', () => {
    const m = measure([[0, 0, 300, 400]]);
    expect(m.ink).toBe(500);
    expect(m.span).toBe(400);
    expect(m.points).toBe(2);
  });
});

it("uses the API's own limits", () => {
  const api = readFileSync(join(__dirname, '../../backend/services/signatureService.js'), 'utf8');
  const constant = (name) => Number(api.match(new RegExp(`const ${name} = (\\d+);`))[1]);
  expect(constant('BOX_W')).toBe(BOX_W);
  expect(constant('MIN_H')).toBe(MIN_H);
  expect(constant('MAX_H')).toBe(MAX_H);
  expect(constant('MIN_INK')).toBe(MIN_INK);
  expect(constant('MIN_SPAN')).toBe(MIN_SPAN);
  expect(constant('MAX_STROKES')).toBe(MAX_STROKES);
  expect(constant('MAX_POINTS')).toBe(MAX_POINTS);
});
