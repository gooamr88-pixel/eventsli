const { SUPPORTED_MARKETS } = require('./markets');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * What each platform setting is allowed to hold.
 *
 * `PATCH /admin/settings/:key` used to check only that a value EXISTED. So
 * `{"default_pct": 150}` gave every new event a 150% commission, `currencies: {}`
 * refused event creation in every country, and `null` was a 500 — each one a
 * single save away, with nothing between the typo and production.
 *
 * Every key has a shape here, unknown fields are refused rather than stored,
 * and the value that is saved is the normalised one this returns.
 *
 * `SETTING_DEFAULTS` are the values the base schema seeds and the code already
 * falls back to (eventService.defaultFinancials, pricingService). They are shown
 * on the settings page for a key that has never been saved.
 *
 * Pure: no imports beyond the markets table, so it is testable without a database.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const SETTING_DEFAULTS = Object.freeze({
  commission: { default_pct: 1.5, default_tax_pct: 0 },
  payment_fee: { default_pct: 2.9, default_fixed_cents: 30 },
  stripe_cost: { pct: 2.9, fixed_cents: 30 },
  currencies: { allowed: ['CAD', 'USD'], by_country: { CA: 'CAD', US: 'USD' } },
  manual_invoice: { due_days: 7, min_hours_before_event: 24 },
});

const percent = { type: 'number', min: 0, max: 100, decimals: 2 };
const cents = { type: 'integer', min: 0, max: 10_000 };

const SCHEMAS = {
  commission: {
    default_pct: { ...percent, label: 'Commission' },
    default_tax_pct: { ...percent, label: 'Tax on commission' },
  },
  payment_fee: {
    default_pct: { ...percent, label: 'Payment fee' },
    default_fixed_cents: { ...cents, label: 'Fixed payment fee' },
    default_mode: { type: 'enum', values: ['auto', 'manual'], optional: true, label: 'Payment fee mode' },
  },
  stripe_cost: {
    pct: { ...percent, label: 'Card cost' },
    fixed_cents: { ...cents, label: 'Fixed card cost' },
  },
  manual_invoice: {
    due_days: { type: 'integer', min: 1, max: 90, label: 'Days to pay' },
    min_hours_before_event: { type: 'integer', min: 0, max: 720, label: 'Hours before the event' },
  },
  currencies: null,   // validated by validateCurrencies — its shape is relational
};

const EDITABLE_SETTINGS = Object.freeze(Object.keys(SCHEMAS));

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function checkField(name, rule, value, errors) {
  if (value === undefined) {
    if (!rule.optional) errors.push(`${rule.label} (${name}) is required.`);
    return undefined;
  }
  if (rule.type === 'enum') {
    if (!rule.values.includes(value)) errors.push(`${rule.label} must be one of: ${rule.values.join(', ')}.`);
    return value;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${rule.label} (${name}) must be a number.`);
    return undefined;
  }
  if (rule.type === 'integer' && !Number.isInteger(value)) {
    errors.push(`${rule.label} (${name}) must be a whole number.`);
  }
  if (rule.decimals !== undefined && Math.abs(Math.round(value * 10 ** rule.decimals) - value * 10 ** rule.decimals) > 1e-6) {
    errors.push(`${rule.label} (${name}) can have at most ${rule.decimals} decimal places.`);
  }
  if (value < rule.min || value > rule.max) {
    errors.push(`${rule.label} (${name}) must be between ${rule.min} and ${rule.max}.`);
  }
  return value;
}

function validateFields(schema, value) {
  const errors = [];
  if (!isPlainObject(value)) return { errors: ['Send an object with the setting\'s fields.'] };

  const unknown = Object.keys(value).filter((k) => !(k in schema));
  if (unknown.length) errors.push(`Not a field of this setting: ${unknown.join(', ')}.`);

  const clean = {};
  for (const [name, rule] of Object.entries(schema)) {
    const checked = checkField(name, rule, value[name], errors);
    if (checked !== undefined) clean[name] = checked;
  }
  return { errors, clean };
}

/**
 * The markets open for new events. Relational, so it has its own check: every
 * country must be a supported market, its currency must be that market's
 * currency (BRD §07 — never chosen separately), and `allowed` is derived from
 * the countries rather than trusted, so the two cannot disagree.
 */
function validateCurrencies(value) {
  const errors = [];
  if (!isPlainObject(value)) return { errors: ['Send { by_country: { CA: "CAD", … } }.'] };

  const unknown = Object.keys(value).filter((k) => !['allowed', 'by_country'].includes(k));
  if (unknown.length) errors.push(`Not a field of this setting: ${unknown.join(', ')}.`);

  const byCountry = value.by_country;
  if (!isPlainObject(byCountry) || Object.keys(byCountry).length === 0) {
    errors.push('Open at least one market — with none, no event can be created anywhere.');
    return { errors };
  }

  const clean = {};
  for (const [country, currency] of Object.entries(byCountry)) {
    const expected = SUPPORTED_MARKETS[country];
    if (!expected) {
      errors.push(`${country} is not a market Eventsli supports (${Object.keys(SUPPORTED_MARKETS).join(', ')}).`);
    } else if (currency !== expected) {
      errors.push(`${country} sells in ${expected}; the currency follows the country.`);
    } else {
      clean[country] = currency;
    }
  }

  if (value.allowed !== undefined && !Array.isArray(value.allowed)) {
    errors.push('allowed must be a list of currency codes.');
  }

  return { errors, clean: { allowed: [...new Set(Object.values(clean))].sort(), by_country: clean } };
}

/** `{ ok: true, value }` with the normalised value, or `{ ok: false, errors }`. */
function validateSetting(key, value) {
  if (!EDITABLE_SETTINGS.includes(key)) {
    return { ok: false, errors: [`Not an editable setting: ${key}.`] };
  }
  const { errors, clean } = key === 'currencies'
    ? validateCurrencies(value)
    : validateFields(SCHEMAS[key], value);
  return errors.length ? { ok: false, errors } : { ok: true, value: clean };
}

module.exports = { EDITABLE_SETTINGS, SETTING_DEFAULTS, validateSetting };
