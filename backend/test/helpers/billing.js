/**
 * Billing details for suites that raise commission invoices.
 *
 * Since 20261123110000 no invoice is issued unless Eventsli's invoicing details
 * (the `invoice_issuer` setting) and the organizer's billing details are
 * complete. Suites that raise invoices call `ensureInvoiceIssuer()` in their
 * `before`, and spread `ORGANIZER_BILLING` into the organizers they create.
 *
 * The issuer is ONE platform-wide setting and the suite runs two files at a
 * time, so this never blanks or restores it: it only fills it in when it is
 * incomplete, with values that are themselves complete. Whatever another file
 * is doing at the same moment, the setting is always valid. The incomplete
 * case is tested through `invoice_issuer_missing(jsonb)`, which takes the
 * value as an argument and touches no shared state.
 */
const TEST_ISSUER = Object.freeze({
  legal_name: 'Eventsli Test Inc.',
  address: '100 Test Street\nToronto, ON M5V 1A1\nCanada',
  tax_id: 'BN 123456789',
  email: 'billing@eventsli-test.invalid',
});

const ORGANIZER_BILLING = Object.freeze({
  billing_address: '1 Organizer Road\nToronto, ON M5V 2B2\nCanada',
  tax_status: 'not_registered',
});

async function ensureInvoiceIssuer(supabase) {
  const { data: row } = await supabase.from('platform_settings')
    .select('value').eq('key', 'invoice_issuer').maybeSingle();
  const { data: missing, error } = await supabase.rpc('invoice_issuer_missing', { p_issuer: row?.value || {} });
  if (error) throw new Error(error.message);
  if (Array.isArray(missing) && missing.length === 0) return row.value;
  await supabase.from('platform_settings').upsert({ key: 'invoice_issuer', value: TEST_ISSUER }, { onConflict: 'key' });
  return TEST_ISSUER;
}

module.exports = { TEST_ISSUER, ORGANIZER_BILLING, ensureInvoiceIssuer };
