/**
 * Display names for the API's event-category enum.
 *
 * The VALUES always come from `GET /public/event-categories` — this map only
 * names them, so a category added server-side still appears (titlecased)
 * instead of vanishing. It was copied into three files, which had already
 * drifted ("Festival" in one, "Festivals" in another).
 */
const LABELS = {
  music: 'Music', festival: 'Festivals', nightlife: 'Nightlife', sports: 'Sports',
  arts: 'Arts', comedy: 'Comedy', film: 'Film', food_drink: 'Food & drink',
  business: 'Business', community: 'Community', education: 'Learning',
  family: 'Family', other: 'Other',
};

export function categoryLabel(value) {
  return LABELS[value] || String(value).replace(/_/g, ' ').replace(/^./, (m) => m.toUpperCase());
}
