/**
 * Display names for event categories.
 *
 * THE DATABASE IS THE SOURCE (`event_categories`, editable at /admin/content).
 * Listings now carry `categoryLabel`, and screens that offer a choice load
 * `GET /public/event-categories` through `useCategories`. This map is only the
 * FALLBACK for the moment before that answer arrives — and it must say what the
 * database says: it used to read "Arts", "Learning" and "Other" where every tab
 * and filter said "Arts & theatre", "Workshops" and "Everything else", so one
 * category had two names depending on the screen. test/categories.test.js holds
 * it to the migrations' seeds.
 */
export const FALLBACK_LABELS = Object.freeze({
  music: 'Music', festival: 'Festivals', nightlife: 'Nightlife', arts: 'Arts & theatre',
  comedy: 'Comedy', sports: 'Sports', food_drink: 'Food & drink', film: 'Film',
  business: 'Business', education: 'Workshops', community: 'Community', family: 'Family',
  other: 'Everything else',
  holiday: 'Holidays & seasonal', gala: 'Galas & banquets', dance: 'Dance', outdoors: 'Outdoors',
  wellness: 'Health & wellness', fashion: 'Fashion & beauty', conference: 'Conferences',
  tech: 'Tech & gaming', charity: 'Charity & fundraisers', culture: 'Culture & heritage',
  faith: 'Faith & spirituality',
});

/**
 * A category's name: the database's when it is known (`labelled`, the list
 * from the API), then the fallback, then the slug made readable — so a category
 * added after this build still appears instead of vanishing.
 */
export function categoryLabel(value, labelled) {
  const fromApi = Array.isArray(labelled) ? labelled.find((c) => c.slug === value)?.label : null;
  return fromApi || FALLBACK_LABELS[value] || String(value || '').replace(/_/g, ' ').replace(/^./, (m) => m.toUpperCase());
}
