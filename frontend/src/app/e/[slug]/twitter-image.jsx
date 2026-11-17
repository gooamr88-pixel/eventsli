/**
 * The same branded card for X (Twitter) as for every other share — see
 * opengraph-image.jsx. Its own file because X reads `twitter:image`, and the
 * page's `generateMetadata` would otherwise still name the raw cover there.
 */
import OpenGraphImage from './opengraph-image';

export const alt = 'An event on Eventsli';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const revalidate = 300;

export default OpenGraphImage;
