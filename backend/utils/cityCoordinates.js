/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Where the cities are.
 *
 * WHY THIS FILE EXISTS RATHER THAN A GEOCODING SERVICE.
 *
 * "Events near me" needs one thing the database cannot supply: the distance
 * between a visitor and a city. `events.city` is text an organizer typed. The
 * obvious fix is to call a geocoder — Nominatim, Google, Mapbox — and the
 * obvious fix is wrong here for three reasons that all bite at once:
 *
 *   • It puts a visitor's COORDINATES into a third party's logs, on the
 *     homepage, before they have asked for anything. That is the one piece of
 *     data this feature exists to handle carefully.
 *   • It is a network call on the critical path of a button someone just
 *     pressed, with a rate limit and a key to rotate.
 *   • It answers a question we do not have. We do not need "what is at these
 *     coordinates"; we need "which of OUR cities is closest", and our cities
 *     are a list of at most a few dozen strings.
 *
 * So the lookup is local and the answer is exact. The visitor's coordinates
 * reach this API, are compared against the table below, and are never stored —
 * see `landingController.nearestCity`.
 *
 * COVERAGE is the markets Eventsli sells in (BRD §07: CA and US) — every
 * metropolitan area above roughly 250,000 people, plus the smaller Canadian
 * cities that carry a disproportionate share of touring. A city absent from
 * this table simply cannot be matched by name; it is still reachable by typing
 * it, and the listing still works. Adding one is a line.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** `[name, country, latitude, longitude]` — the compact form is deliberate:
 *  this is a table, and a table of 140 objects is a page of punctuation. */
const CITIES = [
  // ── Canada ────────────────────────────────────────────────────────────
  ['Toronto', 'CA', 43.6532, -79.3832],
  ['Montreal', 'CA', 45.5019, -73.5674],
  ['Vancouver', 'CA', 49.2827, -123.1207],
  ['Calgary', 'CA', 51.0447, -114.0719],
  ['Edmonton', 'CA', 53.5461, -113.4938],
  ['Ottawa', 'CA', 45.4215, -75.6972],
  ['Winnipeg', 'CA', 49.8951, -97.1384],
  ['Quebec City', 'CA', 46.8139, -71.2080],
  ['Hamilton', 'CA', 43.2557, -79.8711],
  ['Kitchener', 'CA', 43.4516, -80.4925],
  ['London', 'CA', 42.9849, -81.2453],
  ['Halifax', 'CA', 44.6488, -63.5752],
  ['Victoria', 'CA', 48.4284, -123.3656],
  ['Windsor', 'CA', 42.3149, -83.0364],
  ['Saskatoon', 'CA', 52.1332, -106.6700],
  ['Regina', 'CA', 50.4452, -104.6189],
  ['St. John’s', 'CA', 47.5615, -52.7126],
  ['Kelowna', 'CA', 49.8880, -119.4960],
  ['Mississauga', 'CA', 43.5890, -79.6441],
  ['Brampton', 'CA', 43.7315, -79.7624],
  ['Surrey', 'CA', 49.1913, -122.8490],
  ['Burnaby', 'CA', 49.2488, -122.9805],
  ['Laval', 'CA', 45.6066, -73.7124],
  ['Gatineau', 'CA', 45.4765, -75.7013],
  ['Oshawa', 'CA', 43.8971, -78.8658],
  ['Barrie', 'CA', 44.3894, -79.6903],
  ['Guelph', 'CA', 43.5448, -80.2482],
  ['Sherbrooke', 'CA', 45.4042, -71.8929],
  ['Abbotsford', 'CA', 49.0504, -122.3045],
  ['Kingston', 'CA', 44.2312, -76.4860],
  ['Moncton', 'CA', 46.0878, -64.7782],
  ['Thunder Bay', 'CA', 48.3809, -89.2477],
  ['Sudbury', 'CA', 46.4917, -80.9930],
  ['Saint John', 'CA', 45.2733, -66.0633],
  ['Red Deer', 'CA', 52.2681, -113.8112],
  ['Lethbridge', 'CA', 49.6956, -112.8451],
  ['Niagara Falls', 'CA', 43.0896, -79.0849],
  ['Banff', 'CA', 51.1784, -115.5708],
  ['Whistler', 'CA', 50.1163, -122.9574],

  // ── United States ─────────────────────────────────────────────────────
  ['New York', 'US', 40.7128, -74.0060],
  ['Los Angeles', 'US', 34.0522, -118.2437],
  ['Chicago', 'US', 41.8781, -87.6298],
  ['Houston', 'US', 29.7604, -95.3698],
  ['Phoenix', 'US', 33.4484, -112.0740],
  ['Philadelphia', 'US', 39.9526, -75.1652],
  ['San Antonio', 'US', 29.4241, -98.4936],
  ['San Diego', 'US', 32.7157, -117.1611],
  ['Dallas', 'US', 32.7767, -96.7970],
  ['Austin', 'US', 30.2672, -97.7431],
  ['San Jose', 'US', 37.3382, -121.8863],
  ['Jacksonville', 'US', 30.3322, -81.6557],
  ['Fort Worth', 'US', 32.7555, -97.3308],
  ['Columbus', 'US', 39.9612, -82.9988],
  ['Charlotte', 'US', 35.2271, -80.8431],
  ['Indianapolis', 'US', 39.7684, -86.1581],
  ['San Francisco', 'US', 37.7749, -122.4194],
  ['Seattle', 'US', 47.6062, -122.3321],
  ['Denver', 'US', 39.7392, -104.9903],
  ['Washington', 'US', 38.9072, -77.0369],
  ['Boston', 'US', 42.3601, -71.0589],
  ['El Paso', 'US', 31.7619, -106.4850],
  ['Nashville', 'US', 36.1627, -86.7816],
  ['Detroit', 'US', 42.3314, -83.0458],
  ['Oklahoma City', 'US', 35.4676, -97.5164],
  ['Portland', 'US', 45.5152, -122.6784],
  ['Las Vegas', 'US', 36.1699, -115.1398],
  ['Memphis', 'US', 35.1495, -90.0490],
  ['Louisville', 'US', 38.2527, -85.7585],
  ['Baltimore', 'US', 39.2904, -76.6122],
  ['Milwaukee', 'US', 43.0389, -87.9065],
  ['Albuquerque', 'US', 35.0844, -106.6504],
  ['Tucson', 'US', 32.2226, -110.9747],
  ['Fresno', 'US', 36.7378, -119.7871],
  ['Sacramento', 'US', 38.5816, -121.4944],
  ['Kansas City', 'US', 39.0997, -94.5786],
  ['Atlanta', 'US', 33.7490, -84.3880],
  ['Miami', 'US', 25.7617, -80.1918],
  ['Raleigh', 'US', 35.7796, -78.6382],
  ['Omaha', 'US', 41.2565, -95.9345],
  ['Minneapolis', 'US', 44.9778, -93.2650],
  ['Cleveland', 'US', 41.4993, -81.6944],
  ['New Orleans', 'US', 29.9511, -90.0715],
  ['Tampa', 'US', 27.9506, -82.4572],
  ['Orlando', 'US', 28.5383, -81.3792],
  ['St. Louis', 'US', 38.6270, -90.1994],
  ['Pittsburgh', 'US', 40.4406, -79.9959],
  ['Cincinnati', 'US', 39.1031, -84.5120],
  ['Salt Lake City', 'US', 40.7608, -111.8910],
  ['Buffalo', 'US', 42.8864, -78.8784],
  ['Richmond', 'US', 37.5407, -77.4360],
  ['Newark', 'US', 40.7357, -74.1724],
  ['Anchorage', 'US', 61.2181, -149.9003],
  ['Honolulu', 'US', 21.3099, -157.8581],
  ['Boise', 'US', 43.6150, -116.2023],
  ['Spokane', 'US', 47.6588, -117.4260],
  ['Des Moines', 'US', 41.5868, -93.6250],
  ['Madison', 'US', 43.0731, -89.4012],
  ['Charleston', 'US', 32.7765, -79.9311],
  ['Savannah', 'US', 32.0809, -81.0912],
  ['Asheville', 'US', 35.5951, -82.5515],
  ['Austin–Round Rock', 'US', 30.5083, -97.6789],
  ['Brooklyn', 'US', 40.6782, -73.9442],
  ['Queens', 'US', 40.7282, -73.7949],
  ['Oakland', 'US', 37.8044, -122.2712],
  ['Long Beach', 'US', 33.7701, -118.1937],
  ['Mesa', 'US', 33.4152, -111.8315],
  ['Virginia Beach', 'US', 36.8529, -75.9780],
  ['Colorado Springs', 'US', 38.8339, -104.8214],
  ['Arlington', 'US', 32.7357, -97.1081],
  ['Tulsa', 'US', 36.1540, -95.9928],
  ['Wichita', 'US', 37.6872, -97.3301],
  ['Bakersfield', 'US', 35.3733, -119.0187],
  ['Aurora', 'US', 39.7294, -104.8319],
  ['Reno', 'US', 39.5296, -119.8138],
  ['Palm Springs', 'US', 33.8303, -116.5453],
  ['Nashua', 'US', 42.7654, -71.4676],
  ['Providence', 'US', 41.8240, -71.4128],
  ['Hartford', 'US', 41.7658, -72.6734],
  ['Albany', 'US', 42.6526, -73.7562],
  ['Rochester', 'US', 43.1566, -77.6088],
  ['Syracuse', 'US', 43.0481, -76.1474],
  ['Birmingham', 'US', 33.5186, -86.8104],
  ['Jackson', 'US', 32.2988, -90.1848],
  ['Little Rock', 'US', 34.7465, -92.2896],
  ['Baton Rouge', 'US', 30.4515, -91.1871],
  ['Knoxville', 'US', 35.9606, -83.9207],
  ['Chattanooga', 'US', 35.0456, -85.3097],
  ['Lexington', 'US', 38.0406, -84.5037],
  ['Dayton', 'US', 39.7589, -84.1916],
  ['Toledo', 'US', 41.6528, -83.5379],
  ['Grand Rapids', 'US', 42.9634, -85.6681],
  ['Ann Arbor', 'US', 42.2808, -83.7430],
  ['Fort Lauderdale', 'US', 26.1224, -80.1373],
  ['St. Petersburg', 'US', 27.7676, -82.6403],
  ['Boca Raton', 'US', 26.3683, -80.1289],
  ['Scottsdale', 'US', 33.4942, -111.9261],
  ['Santa Fe', 'US', 35.6870, -105.9378],
  ['Eugene', 'US', 44.0521, -123.0868],
  ['Tacoma', 'US', 47.2529, -122.4443],
  ['Anaheim', 'US', 33.8366, -117.9143],
  ['Santa Monica', 'US', 34.0195, -118.4912],
  ['Pasadena', 'US', 34.1478, -118.1445],
  ['Berkeley', 'US', 37.8715, -122.2730],
  ['New Haven', 'US', 41.3083, -72.9279],
  ['Princeton', 'US', 40.3573, -74.6672],
  ['Cambridge', 'US', 42.3736, -71.1097],
];

/**
 * The lookup key.
 *
 * Case and punctuation are folded because an organizer typing a city is the
 * source: "st. louis", "St Louis" and "ST. LOUIS" are one place. The apostrophe
 * in "St. John's" is folded for the same reason — a typist will use either
 * shape of it, and neither should miss.
 */
function normalise(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.'’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const BY_KEY = new Map();
for (const [name, country, lat, lng] of CITIES) {
  BY_KEY.set(`${normalise(name)}|${country}`, { city: name, country, lat, lng });
  // Also without the country, for a caller that has a name and nothing else.
  // First writer wins, so Toronto CA is not overwritten by a US namesake.
  const bare = normalise(name);
  if (!BY_KEY.has(bare)) BY_KEY.set(bare, { city: name, country, lat, lng });
}

/** Coordinates for a city name, or null if it is not in the table. */
function locate(name, country) {
  if (!name) return null;
  const key = normalise(name);
  return BY_KEY.get(country ? `${key}|${country}` : key) || BY_KEY.get(key) || null;
}

/**
 * Great-circle distance in kilometres.
 *
 * The haversine formula rather than a flat Pythagorean approximation on
 * lat/lng. The flat version is off by a factor of cos(latitude) on the
 * east–west axis — at Canadian latitudes that is roughly 40%, which is enough
 * to make Hamilton look further from Toronto than Ottawa is.
 */
function distanceKm(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * The closest of `candidates` to a point, with its distance.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {Array<{city: string, country: string}>} candidates  cities that
 *   actually have events — there is no point returning the nearest city on
 *   the continent if nothing is on there.
 * @returns {{city, country, distanceKm}|null} null when NONE of the candidates
 *   are in the table, which is a real answer: we know where the visitor is and
 *   cannot place any of our own cities.
 */
function nearest(lat, lng, candidates) {
  let best = null;

  for (const candidate of candidates) {
    const known = locate(candidate.city, candidate.country);
    if (!known) continue;
    const km = distanceKm(lat, lng, known.lat, known.lng);
    if (!best || km < best.distanceKm) {
      // The candidate's own spelling is returned, not the table's: it is what
      // `events.city` holds, and it is what the listing has to filter on.
      best = { city: candidate.city, country: candidate.country, distanceKm: km };
    }
  }

  return best ? { ...best, distanceKm: Math.round(best.distanceKm) } : null;
}

module.exports = { locate, nearest, distanceKm, normalise, CITY_COUNT: CITIES.length };
