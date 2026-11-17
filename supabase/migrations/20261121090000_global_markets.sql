-- ═══════════════════════════════════════════════════════════════════════════
-- Eventsli opens to organizers in every country (owner request 2026-11-16).
--
-- Until now a market was CA (CAD) or US (USD), written into three CHECK
-- constraints. They become foreign keys into a `markets` table holding every
-- country Eventsli can operate in — the same rows as backend/utils/markets.json,
-- which the API and the frontend read:
--
--   currency      follows the country, never chosen separately (BRD §07)
--   minor_units   decimals of the currency's minor unit (ISO 4217): amounts
--                 are integers of that unit — yen for JPY, fils for KWD
--   card_capable  Stripe offers accounts there, so card checkout CAN be on.
--                 Everywhere else sells OFFLINE: the organizer's own payment
--                 methods, confirmed by hand, commission invoiced.
--
-- The constraint names are kept, so verify-schema and anything that reports a
-- violation by name still recognise them.
--
-- Six countries under comprehensive sanctions (BY, CU, IR, KP, RU, SY) are not
-- in the table and cannot be chosen.
--
-- Finally every country is OPENED in the `currencies` setting, and card
-- checkout stays on only where it already was (CA, US by default) — a super
-- admin switches it on per country once Stripe onboarding there is verified.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS markets (
  country       CHAR(2) PRIMARY KEY CHECK (country ~ '^[A-Z]{2}$'),
  name          TEXT NOT NULL,
  currency      CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  minor_units   SMALLINT NOT NULL CHECK (minor_units IN (0, 2, 3)),
  region        TEXT NOT NULL,
  card_capable  BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (country, currency)
);

ALTER TABLE markets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON markets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON markets TO service_role;

INSERT INTO markets (country, name, currency, minor_units, region, card_capable) VALUES
  ('AF', 'Afghanistan', 'AFN', 2, 'Asia', false),
  ('AX', 'Åland Islands', 'EUR', 2, 'Europe', false),
  ('AL', 'Albania', 'ALL', 2, 'Europe', false),
  ('DZ', 'Algeria', 'DZD', 2, 'Africa', false),
  ('AS', 'American Samoa', 'USD', 2, 'Oceania', false),
  ('AD', 'Andorra', 'EUR', 2, 'Europe', false),
  ('AO', 'Angola', 'AOA', 2, 'Africa', false),
  ('AI', 'Anguilla', 'XCD', 2, 'Americas', false),
  ('AG', 'Antigua and Barbuda', 'XCD', 2, 'Americas', false),
  ('AR', 'Argentina', 'ARS', 2, 'Americas', false),
  ('AM', 'Armenia', 'AMD', 2, 'Asia', false),
  ('AW', 'Aruba', 'AWG', 2, 'Americas', false),
  ('AU', 'Australia', 'AUD', 2, 'Oceania', true),
  ('AT', 'Austria', 'EUR', 2, 'Europe', true),
  ('AZ', 'Azerbaijan', 'AZN', 2, 'Asia', false),
  ('BS', 'Bahamas', 'BSD', 2, 'Americas', false),
  ('BH', 'Bahrain', 'BHD', 3, 'Middle East', false),
  ('BD', 'Bangladesh', 'BDT', 2, 'Asia', false),
  ('BB', 'Barbados', 'BBD', 2, 'Americas', false),
  ('BE', 'Belgium', 'EUR', 2, 'Europe', true),
  ('BZ', 'Belize', 'BZD', 2, 'Americas', false),
  ('BJ', 'Benin', 'XOF', 0, 'Africa', false),
  ('BM', 'Bermuda', 'BMD', 2, 'Americas', false),
  ('BT', 'Bhutan', 'BTN', 2, 'Asia', false),
  ('BO', 'Bolivia', 'BOB', 2, 'Americas', false),
  ('BA', 'Bosnia and Herzegovina', 'BAM', 2, 'Europe', false),
  ('BW', 'Botswana', 'BWP', 2, 'Africa', false),
  ('BR', 'Brazil', 'BRL', 2, 'Americas', true),
  ('VG', 'British Virgin Islands', 'USD', 2, 'Americas', false),
  ('BN', 'Brunei', 'BND', 2, 'Asia', false),
  ('BG', 'Bulgaria', 'EUR', 2, 'Europe', true),
  ('BF', 'Burkina Faso', 'XOF', 0, 'Africa', false),
  ('BI', 'Burundi', 'BIF', 0, 'Africa', false),
  ('CV', 'Cabo Verde', 'CVE', 2, 'Africa', false),
  ('KH', 'Cambodia', 'KHR', 2, 'Asia', false),
  ('CM', 'Cameroon', 'XAF', 0, 'Africa', false),
  ('CA', 'Canada', 'CAD', 2, 'Americas', true),
  ('BQ', 'Caribbean Netherlands', 'USD', 2, 'Americas', false),
  ('KY', 'Cayman Islands', 'KYD', 2, 'Americas', false),
  ('CF', 'Central African Republic', 'XAF', 0, 'Africa', false),
  ('TD', 'Chad', 'XAF', 0, 'Africa', false),
  ('CL', 'Chile', 'CLP', 0, 'Americas', false),
  ('CN', 'China', 'CNY', 2, 'Asia', false),
  ('CX', 'Christmas Island', 'AUD', 2, 'Oceania', false),
  ('CC', 'Cocos (Keeling) Islands', 'AUD', 2, 'Oceania', false),
  ('CO', 'Colombia', 'COP', 2, 'Americas', false),
  ('KM', 'Comoros', 'KMF', 0, 'Africa', false),
  ('CG', 'Congo', 'XAF', 0, 'Africa', false),
  ('CD', 'Congo (DRC)', 'CDF', 2, 'Africa', false),
  ('CK', 'Cook Islands', 'NZD', 2, 'Oceania', false),
  ('CR', 'Costa Rica', 'CRC', 2, 'Americas', false),
  ('CI', 'Côte d''Ivoire', 'XOF', 0, 'Africa', false),
  ('HR', 'Croatia', 'EUR', 2, 'Europe', true),
  ('CW', 'Curaçao', 'XCG', 2, 'Americas', false),
  ('CY', 'Cyprus', 'EUR', 2, 'Europe', true),
  ('CZ', 'Czechia', 'CZK', 2, 'Europe', true),
  ('DK', 'Denmark', 'DKK', 2, 'Europe', true),
  ('DJ', 'Djibouti', 'DJF', 0, 'Africa', false),
  ('DM', 'Dominica', 'XCD', 2, 'Americas', false),
  ('DO', 'Dominican Republic', 'DOP', 2, 'Americas', false),
  ('EC', 'Ecuador', 'USD', 2, 'Americas', false),
  ('EG', 'Egypt', 'EGP', 2, 'Africa', false),
  ('SV', 'El Salvador', 'USD', 2, 'Americas', false),
  ('GQ', 'Equatorial Guinea', 'XAF', 0, 'Africa', false),
  ('ER', 'Eritrea', 'ERN', 2, 'Africa', false),
  ('EE', 'Estonia', 'EUR', 2, 'Europe', true),
  ('SZ', 'Eswatini', 'SZL', 2, 'Africa', false),
  ('ET', 'Ethiopia', 'ETB', 2, 'Africa', false),
  ('FK', 'Falkland Islands', 'FKP', 2, 'Americas', false),
  ('FO', 'Faroe Islands', 'DKK', 2, 'Europe', false),
  ('FJ', 'Fiji', 'FJD', 2, 'Oceania', false),
  ('FI', 'Finland', 'EUR', 2, 'Europe', true),
  ('FR', 'France', 'EUR', 2, 'Europe', true),
  ('GF', 'French Guiana', 'EUR', 2, 'Americas', false),
  ('PF', 'French Polynesia', 'XPF', 0, 'Oceania', false),
  ('GA', 'Gabon', 'XAF', 0, 'Africa', false),
  ('GM', 'Gambia', 'GMD', 2, 'Africa', false),
  ('GE', 'Georgia', 'GEL', 2, 'Asia', false),
  ('DE', 'Germany', 'EUR', 2, 'Europe', true),
  ('GH', 'Ghana', 'GHS', 2, 'Africa', false),
  ('GI', 'Gibraltar', 'GBP', 2, 'Europe', true),
  ('GR', 'Greece', 'EUR', 2, 'Europe', true),
  ('GL', 'Greenland', 'DKK', 2, 'Americas', false),
  ('GD', 'Grenada', 'XCD', 2, 'Americas', false),
  ('GP', 'Guadeloupe', 'EUR', 2, 'Americas', false),
  ('GU', 'Guam', 'USD', 2, 'Oceania', false),
  ('GT', 'Guatemala', 'GTQ', 2, 'Americas', false),
  ('GG', 'Guernsey', 'GBP', 2, 'Europe', false),
  ('GN', 'Guinea', 'GNF', 0, 'Africa', false),
  ('GW', 'Guinea-Bissau', 'XOF', 0, 'Africa', false),
  ('GY', 'Guyana', 'GYD', 2, 'Americas', false),
  ('HT', 'Haiti', 'HTG', 2, 'Americas', false),
  ('HN', 'Honduras', 'HNL', 2, 'Americas', false),
  ('HK', 'Hong Kong', 'HKD', 2, 'Asia', true),
  ('HU', 'Hungary', 'HUF', 2, 'Europe', true),
  ('IS', 'Iceland', 'ISK', 0, 'Europe', false),
  ('IN', 'India', 'INR', 2, 'Asia', false),
  ('ID', 'Indonesia', 'IDR', 2, 'Asia', false),
  ('IQ', 'Iraq', 'IQD', 3, 'Middle East', false),
  ('IE', 'Ireland', 'EUR', 2, 'Europe', true),
  ('IM', 'Isle of Man', 'GBP', 2, 'Europe', false),
  ('IL', 'Israel', 'ILS', 2, 'Middle East', false),
  ('IT', 'Italy', 'EUR', 2, 'Europe', true),
  ('JM', 'Jamaica', 'JMD', 2, 'Americas', false),
  ('JP', 'Japan', 'JPY', 0, 'Asia', true),
  ('JE', 'Jersey', 'GBP', 2, 'Europe', false),
  ('JO', 'Jordan', 'JOD', 3, 'Middle East', false),
  ('KZ', 'Kazakhstan', 'KZT', 2, 'Asia', false),
  ('KE', 'Kenya', 'KES', 2, 'Africa', false),
  ('KI', 'Kiribati', 'AUD', 2, 'Oceania', false),
  ('XK', 'Kosovo', 'EUR', 2, 'Europe', false),
  ('KW', 'Kuwait', 'KWD', 3, 'Middle East', false),
  ('KG', 'Kyrgyzstan', 'KGS', 2, 'Asia', false),
  ('LA', 'Laos', 'LAK', 2, 'Asia', false),
  ('LV', 'Latvia', 'EUR', 2, 'Europe', true),
  ('LB', 'Lebanon', 'LBP', 2, 'Middle East', false),
  ('LS', 'Lesotho', 'LSL', 2, 'Africa', false),
  ('LR', 'Liberia', 'LRD', 2, 'Africa', false),
  ('LY', 'Libya', 'LYD', 3, 'Africa', false),
  ('LI', 'Liechtenstein', 'CHF', 2, 'Europe', true),
  ('LT', 'Lithuania', 'EUR', 2, 'Europe', true),
  ('LU', 'Luxembourg', 'EUR', 2, 'Europe', true),
  ('MO', 'Macao', 'MOP', 2, 'Asia', false),
  ('MG', 'Madagascar', 'MGA', 2, 'Africa', false),
  ('MW', 'Malawi', 'MWK', 2, 'Africa', false),
  ('MY', 'Malaysia', 'MYR', 2, 'Asia', true),
  ('MV', 'Maldives', 'MVR', 2, 'Asia', false),
  ('ML', 'Mali', 'XOF', 0, 'Africa', false),
  ('MT', 'Malta', 'EUR', 2, 'Europe', true),
  ('MH', 'Marshall Islands', 'USD', 2, 'Oceania', false),
  ('MQ', 'Martinique', 'EUR', 2, 'Americas', false),
  ('MR', 'Mauritania', 'MRU', 2, 'Africa', false),
  ('MU', 'Mauritius', 'MUR', 2, 'Africa', false),
  ('YT', 'Mayotte', 'EUR', 2, 'Africa', false),
  ('MX', 'Mexico', 'MXN', 2, 'Americas', true),
  ('FM', 'Micronesia', 'USD', 2, 'Oceania', false),
  ('MD', 'Moldova', 'MDL', 2, 'Europe', false),
  ('MC', 'Monaco', 'EUR', 2, 'Europe', false),
  ('MN', 'Mongolia', 'MNT', 2, 'Asia', false),
  ('ME', 'Montenegro', 'EUR', 2, 'Europe', false),
  ('MS', 'Montserrat', 'XCD', 2, 'Americas', false),
  ('MA', 'Morocco', 'MAD', 2, 'Africa', false),
  ('MZ', 'Mozambique', 'MZN', 2, 'Africa', false),
  ('MM', 'Myanmar', 'MMK', 2, 'Asia', false),
  ('NA', 'Namibia', 'NAD', 2, 'Africa', false),
  ('NR', 'Nauru', 'AUD', 2, 'Oceania', false),
  ('NP', 'Nepal', 'NPR', 2, 'Asia', false),
  ('NL', 'Netherlands', 'EUR', 2, 'Europe', true),
  ('NC', 'New Caledonia', 'XPF', 0, 'Oceania', false),
  ('NZ', 'New Zealand', 'NZD', 2, 'Oceania', true),
  ('NI', 'Nicaragua', 'NIO', 2, 'Americas', false),
  ('NE', 'Niger', 'XOF', 0, 'Africa', false),
  ('NG', 'Nigeria', 'NGN', 2, 'Africa', false),
  ('NU', 'Niue', 'NZD', 2, 'Oceania', false),
  ('NF', 'Norfolk Island', 'AUD', 2, 'Oceania', false),
  ('MK', 'North Macedonia', 'MKD', 2, 'Europe', false),
  ('MP', 'Northern Mariana Islands', 'USD', 2, 'Oceania', false),
  ('NO', 'Norway', 'NOK', 2, 'Europe', true),
  ('OM', 'Oman', 'OMR', 3, 'Middle East', false),
  ('PK', 'Pakistan', 'PKR', 2, 'Asia', false),
  ('PW', 'Palau', 'USD', 2, 'Oceania', false),
  ('PS', 'Palestine', 'ILS', 2, 'Middle East', false),
  ('PA', 'Panama', 'USD', 2, 'Americas', false),
  ('PG', 'Papua New Guinea', 'PGK', 2, 'Oceania', false),
  ('PY', 'Paraguay', 'PYG', 0, 'Americas', false),
  ('PE', 'Peru', 'PEN', 2, 'Americas', false),
  ('PH', 'Philippines', 'PHP', 2, 'Asia', false),
  ('PL', 'Poland', 'PLN', 2, 'Europe', true),
  ('PT', 'Portugal', 'EUR', 2, 'Europe', true),
  ('PR', 'Puerto Rico', 'USD', 2, 'Americas', false),
  ('QA', 'Qatar', 'QAR', 2, 'Middle East', false),
  ('RE', 'Réunion', 'EUR', 2, 'Africa', false),
  ('RO', 'Romania', 'RON', 2, 'Europe', true),
  ('RW', 'Rwanda', 'RWF', 0, 'Africa', false),
  ('BL', 'Saint Barthélemy', 'EUR', 2, 'Americas', false),
  ('SH', 'Saint Helena', 'SHP', 2, 'Africa', false),
  ('KN', 'Saint Kitts and Nevis', 'XCD', 2, 'Americas', false),
  ('LC', 'Saint Lucia', 'XCD', 2, 'Americas', false),
  ('MF', 'Saint Martin', 'EUR', 2, 'Americas', false),
  ('PM', 'Saint Pierre and Miquelon', 'EUR', 2, 'Americas', false),
  ('VC', 'Saint Vincent and the Grenadines', 'XCD', 2, 'Americas', false),
  ('WS', 'Samoa', 'WST', 2, 'Oceania', false),
  ('SM', 'San Marino', 'EUR', 2, 'Europe', false),
  ('ST', 'São Tomé and Príncipe', 'STN', 2, 'Africa', false),
  ('SA', 'Saudi Arabia', 'SAR', 2, 'Middle East', false),
  ('SN', 'Senegal', 'XOF', 0, 'Africa', false),
  ('RS', 'Serbia', 'RSD', 2, 'Europe', false),
  ('SC', 'Seychelles', 'SCR', 2, 'Africa', false),
  ('SL', 'Sierra Leone', 'SLE', 2, 'Africa', false),
  ('SG', 'Singapore', 'SGD', 2, 'Asia', true),
  ('SX', 'Sint Maarten', 'XCG', 2, 'Americas', false),
  ('SK', 'Slovakia', 'EUR', 2, 'Europe', true),
  ('SI', 'Slovenia', 'EUR', 2, 'Europe', true),
  ('SB', 'Solomon Islands', 'SBD', 2, 'Oceania', false),
  ('SO', 'Somalia', 'SOS', 2, 'Africa', false),
  ('ZA', 'South Africa', 'ZAR', 2, 'Africa', false),
  ('KR', 'South Korea', 'KRW', 0, 'Asia', false),
  ('SS', 'South Sudan', 'SSP', 2, 'Africa', false),
  ('ES', 'Spain', 'EUR', 2, 'Europe', true),
  ('LK', 'Sri Lanka', 'LKR', 2, 'Asia', false),
  ('SD', 'Sudan', 'SDG', 2, 'Africa', false),
  ('SR', 'Suriname', 'SRD', 2, 'Americas', false),
  ('SJ', 'Svalbard and Jan Mayen', 'NOK', 2, 'Europe', false),
  ('SE', 'Sweden', 'SEK', 2, 'Europe', true),
  ('CH', 'Switzerland', 'CHF', 2, 'Europe', true),
  ('TW', 'Taiwan', 'TWD', 2, 'Asia', false),
  ('TJ', 'Tajikistan', 'TJS', 2, 'Asia', false),
  ('TZ', 'Tanzania', 'TZS', 2, 'Africa', false),
  ('TH', 'Thailand', 'THB', 2, 'Asia', true),
  ('TL', 'Timor-Leste', 'USD', 2, 'Asia', false),
  ('TG', 'Togo', 'XOF', 0, 'Africa', false),
  ('TK', 'Tokelau', 'NZD', 2, 'Oceania', false),
  ('TO', 'Tonga', 'TOP', 2, 'Oceania', false),
  ('TT', 'Trinidad and Tobago', 'TTD', 2, 'Americas', false),
  ('TN', 'Tunisia', 'TND', 3, 'Africa', false),
  ('TR', 'Türkiye', 'TRY', 2, 'Europe', false),
  ('TM', 'Turkmenistan', 'TMT', 2, 'Asia', false),
  ('TC', 'Turks and Caicos Islands', 'USD', 2, 'Americas', false),
  ('TV', 'Tuvalu', 'AUD', 2, 'Oceania', false),
  ('VI', 'U.S. Virgin Islands', 'USD', 2, 'Americas', false),
  ('UG', 'Uganda', 'UGX', 0, 'Africa', false),
  ('UA', 'Ukraine', 'UAH', 2, 'Europe', false),
  ('AE', 'United Arab Emirates', 'AED', 2, 'Middle East', true),
  ('GB', 'United Kingdom', 'GBP', 2, 'Europe', true),
  ('US', 'United States', 'USD', 2, 'Americas', true),
  ('UY', 'Uruguay', 'UYU', 2, 'Americas', false),
  ('UZ', 'Uzbekistan', 'UZS', 2, 'Asia', false),
  ('VU', 'Vanuatu', 'VUV', 0, 'Oceania', false),
  ('VA', 'Vatican City', 'EUR', 2, 'Europe', false),
  ('VE', 'Venezuela', 'VES', 2, 'Americas', false),
  ('VN', 'Vietnam', 'VND', 0, 'Asia', false),
  ('WF', 'Wallis and Futuna', 'XPF', 0, 'Oceania', false),
  ('EH', 'Western Sahara', 'MAD', 2, 'Africa', false),
  ('YE', 'Yemen', 'YER', 2, 'Middle East', false),
  ('ZM', 'Zambia', 'ZMW', 2, 'Africa', false),
  ('ZW', 'Zimbabwe', 'USD', 2, 'Africa', false)
ON CONFLICT (country) DO UPDATE SET
  name = EXCLUDED.name,
  currency = EXCLUDED.currency,
  minor_units = EXCLUDED.minor_units,
  region = EXCLUDED.region,
  card_capable = EXCLUDED.card_capable;

-- ─── The CA/US checks become references into the table ────────────────────
ALTER TABLE organizers DROP CONSTRAINT IF EXISTS organizers_country_supported;
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_country_supported;
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_currency_follows_country;

ALTER TABLE organizers ADD CONSTRAINT organizers_country_supported
  FOREIGN KEY (country) REFERENCES markets (country) NOT VALID;
ALTER TABLE events ADD CONSTRAINT events_country_supported
  FOREIGN KEY (country) REFERENCES markets (country) NOT VALID;
-- The pair, so the currency is the one the country sells in.
ALTER TABLE events ADD CONSTRAINT events_currency_follows_country
  FOREIGN KEY (country, currency) REFERENCES markets (country, currency) NOT VALID;

ALTER TABLE organizers VALIDATE CONSTRAINT organizers_country_supported;
ALTER TABLE events VALIDATE CONSTRAINT events_country_supported;
ALTER TABLE events VALIDATE CONSTRAINT events_currency_follows_country;

-- ─── Open every country; card checkout only where it already was ──────────
UPDATE platform_settings ps
   SET value = jsonb_build_object(
         'allowed',    (SELECT jsonb_agg(DISTINCT m.currency ORDER BY m.currency) FROM markets m),
         'by_country', (SELECT jsonb_object_agg(m.country, m.currency) FROM markets m),
         'card',       COALESCE(
                         (SELECT jsonb_agg(c ORDER BY c)
                            FROM jsonb_array_elements_text(ps.value -> 'card') c
                            JOIN markets m ON m.country = c AND m.card_capable),
                         (SELECT jsonb_agg(c ORDER BY c)
                            FROM jsonb_object_keys(ps.value -> 'by_country') c
                           WHERE c IN ('CA', 'US')),
                         '["CA", "US"]'::jsonb)
       ),
       updated_at = now()
 WHERE ps.key = 'currencies';

-- ─── Fixed promo discounts follow the currency's decimals ────────────────
-- claim_promo_code multiplied a fixed discount by 100. Right for dollars and
-- euros; a hundred times too much for the yen, ten times too little for the
-- dinar. Same function otherwise (20260915130000_promo_claims_follow_the_hold).
CREATE OR REPLACE FUNCTION claim_promo_code(
  p_code           TEXT,
  p_event_id       UUID,
  p_reservation_id UUID,
  p_subtotal_cents BIGINT
) RETURNS JSONB AS $$
DECLARE
  v_promo    RECORD;
  v_used     INT;
  v_discount BIGINT;
  v_minor    SMALLINT;
BEGIN
  SELECT * INTO v_promo FROM promo_codes
   WHERE upper(code) = upper(btrim(p_code))
     AND (event_id = p_event_id OR event_id IS NULL)
   FOR UPDATE;

  IF v_promo IS NULL OR NOT v_promo.is_active THEN
    -- One answer for "no such code" and "disabled": telling them apart lets
    -- someone map which codes exist by trying strings.
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND',
      'message', 'That code is not valid.');
  END IF;

  IF v_promo.valid_from IS NOT NULL AND v_promo.valid_from > now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND',
      'message', 'That code is not valid.');
  END IF;
  IF v_promo.valid_until IS NOT NULL AND v_promo.valid_until < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND',
      'message', 'That code has expired.');
  END IF;

  IF v_promo.max_uses IS NOT NULL THEN
    SELECT count(*) INTO v_used
      FROM promo_redemptions pr
      LEFT JOIN reservations r ON r.id = pr.reservation_id
     WHERE pr.promo_id = v_promo.id
       -- This hold's own claim is not competition for itself. Counting it means
       -- a refresh of the checkout page reports the buyer's own code exhausted.
       AND pr.reservation_id IS DISTINCT FROM p_reservation_id
       -- Only claims that still stand: a paid order, or a hold that is open and
       -- not yet past its expiry. A lapsed hold the sweeper has not reached yet
       -- is not somebody using the code.
       AND (pr.order_id IS NOT NULL
            OR r.state = 'converted'
            OR (r.state = 'active' AND r.expires_at > now()));

    IF v_used >= v_promo.max_uses THEN
      RETURN jsonb_build_object('ok', false, 'error', 'CONFLICT',
        'message', 'That code has been fully used.');
    END IF;
  END IF;

  IF v_promo.discount_type = 'percentage' THEN
    v_discount := round(p_subtotal_cents * v_promo.discount_value / 100.0);
  ELSE
    -- A fixed discount is stored in whole currency units: "10" is ten dollars,
    -- ten euros, ten yen. Scaled by the event currency's minor unit, not by a
    -- hundred, which made ¥10 off a ¥1,000 discount.
    SELECT m.minor_units INTO v_minor
      FROM events e JOIN markets m ON m.country = e.country AND m.currency = e.currency
     WHERE e.id = p_event_id;
    v_discount := round(v_promo.discount_value * power(10, COALESCE(v_minor, 2)));
  END IF;

  -- Never more than the order: a negative total is a refund nobody authorised.
  v_discount := LEAST(GREATEST(v_discount, 0), p_subtotal_cents);

  INSERT INTO promo_redemptions (promo_id, reservation_id, amount_cents)
  VALUES (v_promo.id, p_reservation_id, v_discount)
  ON CONFLICT (reservation_id) WHERE reservation_id IS NOT NULL
  DO UPDATE SET promo_id = EXCLUDED.promo_id, amount_cents = EXCLUDED.amount_cents;

  UPDATE reservations SET promo_id = v_promo.id WHERE id = p_reservation_id;

  UPDATE promo_codes
     SET used_count = (SELECT count(*) FROM promo_redemptions WHERE promo_id = v_promo.id)
   WHERE id = v_promo.id;

  RETURN jsonb_build_object('ok', true, 'promo_id', v_promo.id,
    'code', v_promo.code, 'discount_cents', v_discount,
    'discount_type', v_promo.discount_type, 'discount_value', v_promo.discount_value);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─── Price-change log entries name their currency ────────────────────────
-- The admin audit view showed old and new prices as "cents / 100" because the
-- entry did not say what currency they were in — wrong by 100x for the yen.
-- Same trigger function otherwise (20261112090000_seating_pricing_integrity).
CREATE OR REPLACE FUNCTION log_price_change() RETURNS TRIGGER AS $$
DECLARE
  v_actor  UUID := NULLIF(current_setting('eventsli.actor_id', true), '')::UUID;
  v_event  RECORD;
  v_kind   TEXT;
BEGIN
  IF TG_TABLE_NAME = 'ticket_tiers' THEN
    SELECT id, status, currency INTO v_event FROM events WHERE id = NEW.event_id;
    INSERT INTO admin_audit (actor_id, action, target_type, target_id, payload)
    VALUES (v_actor, 'price.change', 'ticket_tier', NEW.id, jsonb_build_object(
      'eventId', NEW.event_id, 'eventStatus', v_event.status, 'currency', v_event.currency, 'name', NEW.name,
      'field', 'price', 'oldCents', OLD.price_cents, 'newCents', NEW.price_cents,
      'soldBefore', OLD.sold_count));
    RETURN NEW;
  END IF;

  SELECT e.id, e.status, e.currency INTO v_event
    FROM venue_maps vm JOIN events e ON e.id = vm.event_id WHERE vm.id = NEW.venue_map_id;

  FOREACH v_kind IN ARRAY ARRAY['price', 'seatPrice', 'ticketType'] LOOP
    IF (v_kind = 'price' AND OLD.price_cents IS DISTINCT FROM NEW.price_cents)
       OR (v_kind = 'seatPrice' AND OLD.seat_price_cents IS DISTINCT FROM NEW.seat_price_cents)
       OR (v_kind = 'ticketType' AND OLD.tier_id IS DISTINCT FROM NEW.tier_id) THEN
      INSERT INTO admin_audit (actor_id, action, target_type, target_id, payload)
      VALUES (v_actor, 'price.change', 'table', NEW.id, jsonb_build_object(
        'eventId', v_event.id, 'eventStatus', v_event.status, 'currency', v_event.currency, 'label', NEW.label,
        'field', v_kind,
        'oldCents', CASE v_kind WHEN 'price' THEN OLD.price_cents WHEN 'seatPrice' THEN OLD.seat_price_cents END,
        'newCents', CASE v_kind WHEN 'price' THEN NEW.price_cents WHEN 'seatPrice' THEN NEW.seat_price_cents END,
        'oldTierId', CASE WHEN v_kind = 'ticketType' THEN OLD.tier_id END,
        'newTierId', CASE WHEN v_kind = 'ticketType' THEN NEW.tier_id END));
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
