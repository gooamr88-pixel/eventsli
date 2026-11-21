/**
 * Social network glyphs for the vendor's links (2026-11-21), drawn on the
 * same 24-unit grid and in currentColor like NavIcon. Decorative: every one
 * sits beside a label naming the network.
 */
const GLYPHS = {
  instagram: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" />
    </>
  ),
  x: <path d="M4 4h4.6l4.1 5.6L17.6 4H20l-6.2 7.1L20.5 20h-4.6l-4.4-6-5.2 6H4l6.6-7.6z" fill="currentColor" />,
  youtube: (
    <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M10 9.2v5.6l4.8-2.8z" fill="currentColor" />
    </>
  ),
  facebook: <path d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.6-1.5h1.6V4.4a21 21 0 0 0-2.4-.1c-2.4 0-4 1.4-4 4.1v2.1H7.6v3h2.7V21z" fill="currentColor" />,
  whatsapp: (
    <>
      <path d="M4.2 19.8l1.1-3.9A8.4 8.4 0 1 1 8.4 19l-4.2.8z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M9.2 8.4c.2-.4.5-.4.7-.4h.5c.2 0 .4 0 .5.4l.7 1.6c.1.2 0 .4-.1.6l-.5.6c.6 1.1 1.5 2 2.7 2.6l.6-.6c.2-.2.4-.2.6-.1l1.6.7c.3.1.3.3.3.5v.5c0 .3-.2.6-.5.8-.5.3-1.3.5-2.2.2a8.3 8.3 0 0 1-4.6-4.3c-.4-.9-.2-1.8.3-2.4z" fill="currentColor" />
    </>
  ),
  linkedin: (
    <>
      <path d="M6.2 9.5V18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="6.2" cy="6" r="1.5" fill="currentColor" />
      <path d="M10.6 18V9.5M10.6 13.2c0-2.2 1.3-3.8 3.4-3.8 2 0 3.4 1.3 3.4 4V18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </>
  ),
  website: (
    <>
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 12h17M12 3.5c2.5 2.6 3.6 5.4 3.6 8.5s-1.1 5.9-3.6 8.5c-2.5-2.6-3.6-5.4-3.6-8.5S9.5 6.1 12 3.5z" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </>
  ),
};

export default function SocialIcon({ name, size = 18 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      {GLYPHS[name] || GLYPHS.website}
    </svg>
  );
}

/** The networks in the reference's order, with what each box expects. */
export const SOCIAL_FIELDS = Object.freeze([
  { key: 'instagram', label: 'Instagram', placeholder: 'pagename' },
  { key: 'x', label: 'X', placeholder: 'pagename' },
  { key: 'youtube', label: 'YouTube', placeholder: 'https://www.youtube.com/channel/…' },
  { key: 'facebook', label: 'Facebook', placeholder: 'pagename' },
  { key: 'whatsapp', label: 'WhatsApp', placeholder: 'https://wa.me/1234567890' },
  { key: 'linkedin', label: 'LinkedIn', placeholder: 'pagename' },
]);
