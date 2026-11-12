/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TIME ZONES AN EVENT CAN RUN IN — every one, not just the market's.
 *
 * The API stores the zone name, and every date on the event page, the ticket,
 * the emails and the door app is formatted with it, so the zone is what "8 pm"
 * MEANS. It used to be a list of Canadian and US zones only, picked by the
 * event's COUNTRY — and the country is the MARKET (it sets the currency), not
 * where the venue is. An event at a Sydney venue could only be given a North
 * American zone, an unknown country fell back to Toronto, and the organizer's
 * "8 pm" was stored as 8 pm in Toronto: up to sixteen hours away from the real
 * show, with every page then printing "EST" beside it.
 *
 * Now:
 *   · the list is worldwide, with the market's own zones first;
 *   · the default is the organizer's own clock wherever in the world it is;
 *   · choosing a venue from search sets the zone from the venue itself
 *     (`placesService.details` returns Google's IANA zone for the place).
 *
 * The world list is a fixed, curated table rather than
 * `Intl.supportedValuesOf('timeZone')`: that list differs between Node's ICU
 * and each browser's, and these options render on the server first — a list
 * that changes between the two is a hydration mismatch. Any valid zone that is
 * not in the table (one Google returns for a venue, an older event's value)
 * is still offered, because `zoneOptions` always includes the current value.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The market countries' own zones, named the way people there say them. */
export const TIME_ZONES = {
  CA: [
    ['America/St_Johns', 'Newfoundland'],
    ['America/Halifax', 'Atlantic — Halifax'],
    ['America/Toronto', 'Eastern — Toronto, Ottawa, Montréal'],
    ['America/Winnipeg', 'Central — Winnipeg'],
    ['America/Regina', 'Saskatchewan — Regina'],
    ['America/Edmonton', 'Mountain — Calgary, Edmonton'],
    ['America/Vancouver', 'Pacific — Vancouver'],
    ['America/Whitehorse', 'Yukon — Whitehorse'],
  ],
  US: [
    ['America/New_York', 'Eastern — New York, Miami'],
    ['America/Chicago', 'Central — Chicago, Houston'],
    ['America/Denver', 'Mountain — Denver'],
    ['America/Phoenix', 'Arizona — Phoenix'],
    ['America/Los_Angeles', 'Pacific — Los Angeles, Seattle'],
    ['America/Anchorage', 'Alaska — Anchorage'],
    ['Pacific/Honolulu', 'Hawaii — Honolulu'],
    ['America/Puerto_Rico', 'Atlantic — Puerto Rico'],
  ],
};

/**
 * Everywhere else, by region. One zone per civil time area, labelled
 * "Country — cities". Covers every offset in use, including the odd ones
 * (India +5:30, Nepal +5:45, Adelaide +9:30/+10:30, Chatham +12:45, Kiribati +14).
 */
const WORLD = [
  ['Mexico, Central & South America, Caribbean', [
    ['America/Tijuana', 'Mexico — Tijuana'],
    ['America/Hermosillo', 'Mexico — Hermosillo'],
    ['America/Mazatlan', 'Mexico — Mazatlán, La Paz'],
    ['America/Mexico_City', 'Mexico — Mexico City, Guadalajara, Monterrey'],
    ['America/Cancun', 'Mexico — Cancún'],
    ['America/Guatemala', 'Guatemala'],
    ['America/El_Salvador', 'El Salvador'],
    ['America/Tegucigalpa', 'Honduras'],
    ['America/Managua', 'Nicaragua'],
    ['America/Costa_Rica', 'Costa Rica'],
    ['America/Panama', 'Panama'],
    ['America/Havana', 'Cuba — Havana'],
    ['America/Jamaica', 'Jamaica — Kingston'],
    ['America/Santo_Domingo', 'Dominican Republic — Santo Domingo'],
    ['America/Port-au-Prince', 'Haiti — Port-au-Prince'],
    ['America/Barbados', 'Barbados'],
    ['America/Port_of_Spain', 'Trinidad and Tobago'],
    ['America/Bogota', 'Colombia — Bogotá'],
    ['America/Caracas', 'Venezuela — Caracas'],
    ['America/Guayaquil', 'Ecuador — Quito, Guayaquil'],
    ['America/Lima', 'Peru — Lima'],
    ['America/La_Paz', 'Bolivia — La Paz'],
    ['America/Santiago', 'Chile — Santiago'],
    ['America/Asuncion', 'Paraguay — Asunción'],
    ['America/Montevideo', 'Uruguay — Montevideo'],
    ['America/Argentina/Buenos_Aires', 'Argentina — Buenos Aires'],
    ['America/Manaus', 'Brazil — Manaus'],
    ['America/Sao_Paulo', 'Brazil — São Paulo, Rio de Janeiro, Brasília'],
    ['America/Noronha', 'Brazil — Fernando de Noronha'],
    ['America/Nuuk', 'Greenland — Nuuk'],
    ['Atlantic/Bermuda', 'Bermuda'],
  ]],
  ['Europe', [
    ['Atlantic/Azores', 'Portugal — Azores'],
    ['Atlantic/Reykjavik', 'Iceland — Reykjavík'],
    ['Europe/London', 'United Kingdom — London, Manchester, Edinburgh'],
    ['Europe/Dublin', 'Ireland — Dublin'],
    ['Europe/Lisbon', 'Portugal — Lisbon'],
    ['Atlantic/Canary', 'Spain — Canary Islands'],
    ['Europe/Madrid', 'Spain — Madrid, Barcelona'],
    ['Europe/Paris', 'France — Paris'],
    ['Europe/Brussels', 'Belgium — Brussels'],
    ['Europe/Amsterdam', 'Netherlands — Amsterdam'],
    ['Europe/Luxembourg', 'Luxembourg'],
    ['Europe/Berlin', 'Germany — Berlin, Munich, Frankfurt'],
    ['Europe/Zurich', 'Switzerland — Zürich, Geneva'],
    ['Europe/Vienna', 'Austria — Vienna'],
    ['Europe/Rome', 'Italy — Rome, Milan'],
    ['Europe/Malta', 'Malta'],
    ['Europe/Copenhagen', 'Denmark — Copenhagen'],
    ['Europe/Oslo', 'Norway — Oslo'],
    ['Europe/Stockholm', 'Sweden — Stockholm'],
    ['Europe/Prague', 'Czechia — Prague'],
    ['Europe/Warsaw', 'Poland — Warsaw'],
    ['Europe/Budapest', 'Hungary — Budapest'],
    ['Europe/Belgrade', 'Serbia — Belgrade'],
    ['Europe/Zagreb', 'Croatia — Zagreb'],
    ['Europe/Helsinki', 'Finland — Helsinki'],
    ['Europe/Tallinn', 'Estonia — Tallinn'],
    ['Europe/Riga', 'Latvia — Riga'],
    ['Europe/Vilnius', 'Lithuania — Vilnius'],
    ['Europe/Kyiv', 'Ukraine — Kyiv'],
    ['Europe/Bucharest', 'Romania — Bucharest'],
    ['Europe/Sofia', 'Bulgaria — Sofia'],
    ['Europe/Athens', 'Greece — Athens'],
    ['Asia/Nicosia', 'Cyprus — Nicosia'],
    ['Europe/Istanbul', 'Türkiye — Istanbul, Ankara'],
    ['Europe/Minsk', 'Belarus — Minsk'],
    ['Europe/Moscow', 'Russia — Moscow, St Petersburg'],
  ]],
  ['Africa', [
    ['Atlantic/Cape_Verde', 'Cape Verde'],
    ['Africa/Dakar', 'Senegal — Dakar'],
    ['Africa/Abidjan', "Côte d'Ivoire — Abidjan"],
    ['Africa/Accra', 'Ghana — Accra'],
    ['Africa/Casablanca', 'Morocco — Casablanca'],
    ['Africa/Algiers', 'Algeria — Algiers'],
    ['Africa/Tunis', 'Tunisia — Tunis'],
    ['Africa/Lagos', 'Nigeria — Lagos, Abuja'],
    ['Africa/Kinshasa', 'DR Congo — Kinshasa'],
    ['Africa/Luanda', 'Angola — Luanda'],
    ['Africa/Cairo', 'Egypt — Cairo'],
    ['Africa/Tripoli', 'Libya — Tripoli'],
    ['Africa/Khartoum', 'Sudan — Khartoum'],
    ['Africa/Johannesburg', 'South Africa — Johannesburg, Cape Town'],
    ['Africa/Harare', 'Zimbabwe — Harare'],
    ['Africa/Lusaka', 'Zambia — Lusaka'],
    ['Africa/Maputo', 'Mozambique — Maputo'],
    ['Africa/Kigali', 'Rwanda — Kigali'],
    ['Africa/Nairobi', 'Kenya — Nairobi'],
    ['Africa/Addis_Ababa', 'Ethiopia — Addis Ababa'],
    ['Africa/Dar_es_Salaam', 'Tanzania — Dar es Salaam'],
    ['Africa/Kampala', 'Uganda — Kampala'],
    ['Indian/Antananarivo', 'Madagascar — Antananarivo'],
    ['Indian/Mauritius', 'Mauritius'],
  ]],
  ['Middle East & Asia', [
    ['Asia/Jerusalem', 'Israel — Jerusalem, Tel Aviv'],
    ['Asia/Beirut', 'Lebanon — Beirut'],
    ['Asia/Amman', 'Jordan — Amman'],
    ['Asia/Damascus', 'Syria — Damascus'],
    ['Asia/Baghdad', 'Iraq — Baghdad'],
    ['Asia/Riyadh', 'Saudi Arabia — Riyadh, Jeddah'],
    ['Asia/Kuwait', 'Kuwait'],
    ['Asia/Qatar', 'Qatar — Doha'],
    ['Asia/Bahrain', 'Bahrain'],
    ['Asia/Tehran', 'Iran — Tehran'],
    ['Asia/Dubai', 'United Arab Emirates — Dubai, Abu Dhabi'],
    ['Asia/Muscat', 'Oman — Muscat'],
    ['Asia/Baku', 'Azerbaijan — Baku'],
    ['Asia/Tbilisi', 'Georgia — Tbilisi'],
    ['Asia/Yerevan', 'Armenia — Yerevan'],
    ['Asia/Kabul', 'Afghanistan — Kabul'],
    ['Asia/Karachi', 'Pakistan — Karachi, Lahore'],
    ['Asia/Tashkent', 'Uzbekistan — Tashkent'],
    ['Asia/Kolkata', 'India — Mumbai, Delhi, Bengaluru'],
    ['Asia/Colombo', 'Sri Lanka — Colombo'],
    ['Asia/Kathmandu', 'Nepal — Kathmandu'],
    ['Asia/Almaty', 'Kazakhstan — Almaty'],
    ['Asia/Dhaka', 'Bangladesh — Dhaka'],
    ['Asia/Yangon', 'Myanmar — Yangon'],
    ['Asia/Bangkok', 'Thailand — Bangkok'],
    ['Asia/Ho_Chi_Minh', 'Vietnam — Ho Chi Minh City, Hanoi'],
    ['Asia/Jakarta', 'Indonesia — Jakarta'],
    ['Asia/Makassar', 'Indonesia — Bali, Makassar'],
    ['Asia/Jayapura', 'Indonesia — Jayapura'],
    ['Asia/Kuala_Lumpur', 'Malaysia — Kuala Lumpur'],
    ['Asia/Singapore', 'Singapore'],
    ['Asia/Manila', 'Philippines — Manila'],
    ['Asia/Shanghai', 'China — Beijing, Shanghai'],
    ['Asia/Hong_Kong', 'Hong Kong'],
    ['Asia/Taipei', 'Taiwan — Taipei'],
    ['Asia/Ulaanbaatar', 'Mongolia — Ulaanbaatar'],
    ['Asia/Seoul', 'South Korea — Seoul'],
    ['Asia/Tokyo', 'Japan — Tokyo, Osaka'],
    ['Asia/Yekaterinburg', 'Russia — Yekaterinburg'],
    ['Asia/Novosibirsk', 'Russia — Novosibirsk'],
    ['Asia/Vladivostok', 'Russia — Vladivostok'],
  ]],
  ['Australia & Pacific', [
    ['Australia/Perth', 'Australia — Perth (Western)'],
    ['Australia/Darwin', 'Australia — Darwin (Northern Territory)'],
    ['Australia/Adelaide', 'Australia — Adelaide (South Australia)'],
    ['Australia/Brisbane', 'Australia — Brisbane (Queensland)'],
    ['Australia/Sydney', 'Australia — Sydney, Canberra (New South Wales, ACT)'],
    ['Australia/Melbourne', 'Australia — Melbourne (Victoria)'],
    ['Australia/Hobart', 'Australia — Hobart (Tasmania)'],
    ['Australia/Lord_Howe', 'Australia — Lord Howe Island'],
    ['Pacific/Guam', 'Guam'],
    ['Pacific/Port_Moresby', 'Papua New Guinea — Port Moresby'],
    ['Pacific/Noumea', 'New Caledonia — Nouméa'],
    ['Pacific/Fiji', 'Fiji — Suva'],
    ['Pacific/Auckland', 'New Zealand — Auckland, Wellington'],
    ['Pacific/Chatham', 'New Zealand — Chatham Islands'],
    ['Pacific/Tongatapu', "Tonga — Nuku'alofa"],
    ['Pacific/Apia', 'Samoa — Apia'],
    ['Pacific/Kiritimati', 'Kiribati — Kiritimati'],
    ['Pacific/Tahiti', 'French Polynesia — Tahiti'],
    ['Pacific/Pago_Pago', 'American Samoa — Pago Pago'],
  ]],
  ['Other', [
    ['UTC', 'Coordinated Universal Time (UTC)'],
  ]],
];

const COUNTRY_GROUP = { CA: 'Canada', US: 'United States' };

/** Every listed zone → its label, for lookups. */
const LABELS = new Map([
  ...TIME_ZONES.CA, ...TIME_ZONES.US, ...WORLD.flatMap(([, zones]) => zones),
]);

/** Whether this runtime can format in `zone` — the same test the API applies. */
export function isTimeZone(zone) {
  if (!zone || typeof zone !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(0);
    return true;
  } catch {
    return false;
  }
}

const FALLBACK = { CA: 'America/Toronto', US: 'America/New_York' };

/**
 * The zone to preselect before a venue is chosen: the organizer's own clock,
 * wherever in the world it is — they are usually where their events are.
 *
 * Only when the browser gives no usable zone does the market's most populous
 * zone stand in. This used to REQUIRE the browser's zone to be Canadian or
 * American and replace anything else with Toronto, which is how an organizer
 * in Sydney ended up with every event sixteen hours out.
 */
export function defaultTimeZone(country, browserZone) {
  if (isTimeZone(browserZone)) return browserZone;
  return FALLBACK[country] || 'UTC';
}

/** The market's own zones (Canada's or the US's); empty for any other code. */
export function zonesFor(country) {
  return TIME_ZONES[country] || [];
}

/** "Australia/Sydney" → "Sydney"; "America/Argentina/Buenos_Aires" → "Buenos Aires". */
function cityOf(zone) {
  return String(zone).split('/').pop().replace(/_/g, ' ');
}

/** "GMT+11", "GMT-2:30" — the zone's offset right now, or '' if Intl cannot say. */
export function zoneOffset(zone, at = new Date()) {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(at).find((p) => p.type === 'timeZoneName');
    return part ? part.value.replace(/^GMT$/, 'GMT+0') : '';
  } catch {
    return '';
  }
}

/** How the picker names one zone: its label (or its city), with the offset. */
export function zoneOptionLabel(zone, at = new Date()) {
  const name = LABELS.get(zone) || `${cityOf(zone)} (${zone})`;
  const offset = zoneOffset(zone, at);
  return offset ? `${name} · ${offset}` : name;
}

/**
 * A zone, as a hint names it: "Eastern time", "Sydney time".
 *
 * For the North American zones it is the civil zone's name, which is what
 * people there say; everywhere else it is the zone's city, which is
 * unambiguous where a country name is not (Australia has five).
 */
export function zoneLabel(zone) {
  if (!zone) return '';
  const local = [...TIME_ZONES.CA, ...TIME_ZONES.US].find(([z]) => z === zone);
  if (local) return `${local[1].split(' — ')[0]} time`;
  return `${cityOf(zone)} time`;
}

/**
 * The options for a time-zone `<select>`, grouped: the market's own zones
 * first (what most events need), then every region of the world.
 *
 * `current` is always present — a zone Google returned for a venue, or one an
 * older event was saved with, may not be in the table, and a select whose
 * value is not among its options silently shows (and saves) the first one.
 */
export function zoneOptions(country, current, at = new Date()) {
  const option = (zone) => [zone, zoneOptionLabel(zone, at)];
  const first = COUNTRY_GROUP[country] ? country : null;
  const groups = [];

  if (current && !LABELS.has(current) && isTimeZone(current)) {
    groups.push({ label: 'Current', options: [option(current)] });
  }
  for (const code of [first, ...Object.keys(COUNTRY_GROUP).filter((c) => c !== first)].filter(Boolean)) {
    groups.push({ label: COUNTRY_GROUP[code], options: TIME_ZONES[code].map(([z]) => option(z)) });
  }
  for (const [label, zones] of WORLD) {
    groups.push({ label, options: zones.map(([z]) => option(z)) });
  }
  return groups;
}

/** Every zone in the table, flat — for tests and validation. */
export const ALL_LISTED_ZONES = Object.freeze([...LABELS.keys()]);
