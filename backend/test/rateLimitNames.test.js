const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Every rate limiter has its own name, so with REDIS_URL set no two share a
 * counter (TECH-AUDIT-LOG T-020), and the login budget is keyed on the account
 * rather than on one spelling of its address (T-019).
 */
const { makeLimiter, accountKey } = require('../middleware/rateLimit');

test('REGRESSION T-020: a limiter without a name is refused at construction', () => {
  assert.throws(() => makeLimiter({ windowMs: 1000, max: 1 }), /needs a unique `name`/);
});

test('two limiters may not share a name', () => {
  makeLimiter({ windowMs: 1000, max: 1, name: 'test-only-unique' });
  assert.throws(() => makeLimiter({ windowMs: 1000, max: 1, name: 'test-only-unique' }), /already in use/);
});

test('every makeLimiter call under routes/ carries a literal, distinct name', () => {
  const dir = path.join(__dirname, '..', 'routes');
  const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p);
  });
  walk(dir);

  const names = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    let i = src.indexOf('makeLimiter(');
    while (i !== -1) {
      let depth = 0; let j = src.indexOf('(', i); const start = j;
      for (; j < src.length; j += 1) {
        if (src[j] === '(') depth += 1;
        else if (src[j] === ')') { depth -= 1; if (!depth) break; }
      }
      const m = src.slice(start, j).match(/name:\s*['"]([^'"]+)['"]/);
      assert.ok(m, `${path.relative(dir, f)}: a makeLimiter call has no name`);
      names.push(m[1]);
      i = src.indexOf('makeLimiter(', j);
    }
  }
  assert.ok(names.length >= 20, `found ${names.length} limiters`);
  assert.equal(new Set(names).size, names.length, `duplicate names: ${names}`);
});

test('REGRESSION T-019: every spelling of one Gmail account shares one login budget', () => {
  const k = accountKey('victim@gmail.com');
  assert.equal(k, 'victim@gmail.com');
  for (const v of ['Victim@Gmail.com', 'v.ictim@gmail.com', 'victim+1@gmail.com', ' v.i.c.t.i.m+x@googlemail.com ']) {
    assert.equal(accountKey(v), k, v);
  }
});

test('different Gmail accounts keep different budgets', () => {
  // Merging spellings must never merge PEOPLE: a key that collapsed every
  // Gmail address to "@gmail.com" would let one attacker lock all of them out.
  assert.notEqual(accountKey('alice@gmail.com'), accountKey('bob@gmail.com'));
  assert.equal(accountKey('a.l.i.c.e@gmail.com'), 'alice@gmail.com');
});

test('other domains keep their dots but lose a +tag and their case', () => {
  assert.equal(accountKey('First.Last+promo@Company.test'), 'first.last@company.test');
  assert.notEqual(accountKey('first.last@company.test'), accountKey('firstlast@company.test'));
  assert.equal(accountKey(''), '');
  assert.equal(accountKey(undefined), '');
});
