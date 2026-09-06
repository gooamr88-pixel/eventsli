/**
 * A deliberately small Markdown renderer for the published terms.
 *
 * No library. The input is not user content — it is one document we wrote and
 * seeded ourselves, in a fixed subset: headings, paragraphs, lists, bold,
 * italic and inline code. Pulling in a parser plus a sanitiser for that is a
 * dependency in the checkout path to render text we control.
 *
 * It builds React ELEMENTS, never HTML strings, so there is no
 * `dangerouslySetInnerHTML` and therefore nothing to sanitise: anything this
 * does not recognise renders as literal text rather than as markup.
 *
 * A server component — the terms are static prose.
 */
export default function Markdown({ source }) {
  if (!source) return null;

  const blocks = String(source).split(/\n{2,}/);

  return (
    <div className="fx-stack">
      {blocks.map((raw, index) => {
        const block = raw.trim();
        if (!block) return null;
        // Position IS the identity here: the document is static prose rendered
        // once, blocks never reorder, and there is nothing else unique about a
        // paragraph.
        const key = `b${index}`;

        const heading = block.match(/^(#{1,4})\s+(.*)$/s);
        if (heading && !heading[2].includes('\n')) {
          const level = heading[1].length;
          const Tag = `h${Math.min(level + 1, 6)}`;
          /**
           * Whole class names, never a name assembled from a variable.
           * Tailwind scans the source as TEXT — a template literal like
           * `text-[length:${size}]` is a string it never sees, so the rule is
           * simply absent from the stylesheet and the heading renders at the
           * body size. Nothing errors; the page is just quietly wrong.
           */
          const size = level === 1
            ? 'text-2xl'
            : level === 2
              ? 'text-lg'
              : 'text-md';
          return <Tag key={key} className={size}>{inline(heading[2])}</Tag>;
        }

        if (/^[-*]\s+/m.test(block) && block.split('\n').every((l) => /^[-*]\s+/.test(l.trim()))) {
          return (
            <ul key={key} className="fx-stack fx-stack--sm list-disc pl-5 text-muted">
              {block.split('\n').map((line, i) => (
                <li key={`${key}-${i}`}>{inline(line.replace(/^\s*[-*]\s+/, ''))}</li>
              ))}
            </ul>
          );
        }

        // `_Version 1 · Eventsli_` — the seeded documents open with one.
        const emphasisOnly = block.match(/^_(.+)_$/s);
        if (emphasisOnly) {
          return <p key={key} className="text-sm text-subtle">{emphasisOnly[1]}</p>;
        }

        return (
          <p key={key} className="max-w-[68ch] text-muted">
            {inline(block.replace(/\n/g, ' '))}
          </p>
        );
      })}
    </div>
  );
}

/**
 * `**bold**`, `_italic_` and `` `code` ``, as elements.
 *
 * One pass with a single alternating regex rather than three sequential ones:
 * running them in sequence would let a `**` inside a code span be turned into
 * bold, which is how a renderer starts inventing markup that was not in the
 * source.
 */
function inline(text) {
  const parts = [];
  const pattern = /(\*\*[^*]+\*\*|_[^_]+_|`[^`]+`)/g;
  let last = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    const key = `i${match.index}`;

    if (token.startsWith('**')) {
      parts.push(<strong key={key} className="text-ink">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      parts.push(<code key={key} className="text-ink">{token.slice(1, -1)}</code>);
    } else {
      parts.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = match.index + token.length;
  }

  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
