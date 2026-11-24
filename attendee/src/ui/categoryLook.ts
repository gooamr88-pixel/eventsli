import type { IconName } from './Icon';

/**
 * How a category looks when it has no photo — which is every category on
 * production today (2026-11-24): its own icon on its own soft colour. Without
 * this the tiles fell back to the category name in huge type, which wrapped
 * into "Baza / rs" across the label.
 *
 * Known slugs get a fitting icon; anything new still gets a tidy tile.
 */
const ICONS: Record<string, IconName> = {
  bazar: 'cart', concert: 'mic', ladies_night: 'glass', music: 'music', festival: 'flag', holiday: 'gift',
  nightlife: 'glass', gala: 'crown', arts: 'palette', dance: 'sparkle', comedy: 'smile', sports: 'ball',
  outdoors: 'leaf', food_drink: 'food', wellness: 'pulse', film: 'film', fashion: 'shirt', business: 'briefcase',
  conference: 'chat', tech: 'laptop', education: 'bulb', community: 'users', charity: 'heart', culture: 'building',
  faith: 'star', family: 'users', other: 'grid',
};

/** Soft grounds with a strong ink of the same hue (ink on ground ≥ 4.5:1). */
const TONES = [
  { bg: '#fff1f2', ink: '#c0182a' },
  { bg: '#fff6d6', ink: '#8a5a00' },
  { bg: '#eaf1ff', ink: '#2450b8' },
  { bg: '#e8f7ee', ink: '#17703d' },
  { bg: '#f3ecff', ink: '#6a3cc4' },
  { bg: '#e6f6fa', ink: '#0d6c82' },
] as const;

export function categoryLook(slug: string, index: number): { icon: IconName; bg: string; ink: string } {
  const tone = TONES[index % TONES.length];
  return { icon: ICONS[slug] ?? 'grid', bg: tone.bg, ink: tone.ink };
}
