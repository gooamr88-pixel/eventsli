/**
 * A heading with its blue words.
 *
 * Every storefront heading colours one phrase — "Popular *events* you can't
 * miss". The headings are rows in `site_content`, so the colour has to be
 * something an admin can type: the phrase between asterisks is the accent.
 *
 * `lastWord` is for section headings only: a heading saved with no asterisks
 * gets its last word coloured, so every band still has its blue word before
 * anybody edits the copy. The hero title does not use it — its accent is the
 * separate `titleAccent` field.
 */
export default function Accent({ text, lastWord = false }) {
  if (!text) return null;
  const value = String(text);

  if (lastWord && !/\*[^*]+\*/.test(value)) {
    const cut = value.trimEnd().lastIndexOf(' ');
    if (cut > 0) {
      return (
        <>
          {value.slice(0, cut + 1)}
          <span className="es-lp-accent">{value.slice(cut + 1)}</span>
        </>
      );
    }
  }

  return value
    .split(/(\*[^*]+\*)/g)
    .map((part, i) => (/^\*[^*]+\*$/.test(part)
      // Index keys: a split string has no other identity, and it never reorders.
      ? <span key={i} className="es-lp-accent">{part.slice(1, -1)}</span>
      : part));
}
