import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FALLBACK_LABELS, categoryLabel } from '../src/app/lib/categories';

/**
 * REGRESSION (2026-10-15) — one category had two names. The fallback map said
 * "Arts", "Learning" and "Other" while every tab and filter, reading the
 * database, said "Arts & theatre", "Workshops" and "Everything else".
 *
 * The fallback is shown before the API answers, so it must say exactly what the
 * migrations seed: every seeded slug, under the seeded label, and nothing the
 * database does not have.
 */
const MIGRATIONS = join(__dirname, '..', '..', 'supabase', 'migrations');

function seededCategories() {
  const seeds = {};
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    const insert = /insert\s+into\s+(?:public\.)?event_categories\s*\(([^)]*)\)\s*values([\s\S]*?);/gi;
    for (const [, columns, body] of sql.matchAll(insert)) {
      const cols = columns.split(',').map((c) => c.trim());
      const slugAt = cols.indexOf('slug');
      const labelAt = cols.indexOf('label');
      // One tuple per line: ('slug', 'Label', …). '' is SQL's escaped quote.
      for (const [, tuple] of body.matchAll(/\(((?:'(?:[^']|'')*'|[^()'])*)\)/g)) {
        const values = [...tuple.matchAll(/'((?:[^']|'')*)'|([^,\s][^,]*)/g)].map((m) => (m[1] ?? m[2]).replace(/''/g, "'").trim());
        seeds[values[slugAt]] = values[labelAt];
      }
    }
  }
  return seeds;
}

describe('event categories', () => {
  const seeds = seededCategories();

  test('the migrations seed at least the original thirteen and the eleven added', () => {
    expect(Object.keys(seeds).length).toBeGreaterThanOrEqual(24);
    expect(seeds.arts).toBe('Arts & theatre');
    expect(seeds.faith).toBe('Faith & spirituality');
  });

  test('the fallback names every seeded category exactly as the database does', () => {
    expect(FALLBACK_LABELS).toEqual(seeds);
  });

  test('a label from the API wins over the fallback', () => {
    expect(categoryLabel('arts', [{ slug: 'arts', label: 'Theatre & arts' }])).toBe('Theatre & arts');
  });

  test('an unknown slug is made readable rather than shown raw or dropped', () => {
    expect(categoryLabel('street_food')).toBe('Street food');
    expect(categoryLabel('')).toBe('');
  });
});
