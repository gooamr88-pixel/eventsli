import Link from 'next/link';
import { describeError } from '../utils/errors';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The four things every async surface in this app has to say: loading, empty,
 * something-went-wrong, and something-you-should-know.
 *
 * WHY ONE FILE. They are the same decision — "what goes here when the real
 * content cannot" — and they are almost always imported together. Four
 * thirty-line files would be four imports to keep straight for no benefit; the
 * marketing Blocks are kept in one file for the same reason.
 *
 * WHY COMPONENTS AND NOT JUST CLASSES. Unlike `.es-btn` and `.es-card`, each of
 * these has STRUCTURE — a skeleton has a row count, an error has to be run
 * through `describeError` before anything is rendered. A class cannot carry
 * that, and hand-assembling it at each of the twenty-four call sites is what
 * produced twenty-four different answers.
 *
 * SERVER COMPONENTS, all of them. No state, no effects. A `'use client'` here
 * would pull every page that shows a spinner into the client bundle.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * The shape of what is coming.
 *
 * Replaces `<p className="text-sm text-subtle">Loading…</p>`, which was the
 * answer on twenty-four surfaces. Two things follow from showing the shape
 * instead: the reader knows what they are waiting for, and the arrival does not
 * shove the page down — the skeleton occupies the space the content will.
 *
 * `role="status"` + `aria-label` rather than the blocks themselves being
 * readable: a screen reader gets one "Loading" announcement instead of nine
 * empty divs, and `aria-live="polite"` means it does not interrupt whatever the
 * person was already listening to.
 *
 * @param {'list'|'card'|'stats'|'text'} [variant]
 * @param {number} [rows]
 */
export function Loading({ variant = 'list', rows = 3, label = 'Loading' }) {
  return (
    <div role="status" aria-live="polite" aria-label={label} className="fx-stack fx-stack--sm">
      {/* `.es-statgrid` and not `.fx-grid--4`: the same grid the real tiles
          use, so the skeleton does not lay out three-plus-one and then reflow
          into two-by-two the moment the data lands. */}
      {variant === 'stats' && (
        <div className="es-statgrid">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="es-stat">
              <span className="es-skeleton es-skeleton--line w-16" />
              <span className="es-skeleton mt-1 h-7 w-24" />
            </div>
          ))}
        </div>
      )}

      {variant === 'list' && Array.from({ length: rows }, (_, i) => (
        <div key={i} className="es-card fx-stack fx-stack--sm p-4">
          {/* Deliberately uneven widths. A stack of identical bars reads as a
              loading GRAPHIC; varied ones read as text that has not arrived,
              which is what this is standing in for. */}
          <span className="es-skeleton es-skeleton--text w-1/2" />
          <span className="es-skeleton es-skeleton--line w-1/3" />
        </div>
      ))}

      {variant === 'card' && (
        <div className="es-card fx-stack fx-stack--sm p-5">
          <span className="es-skeleton es-skeleton--text w-2/5" />
          <span className="es-skeleton es-skeleton--line w-full" />
          <span className="es-skeleton es-skeleton--line w-4/5" />
        </div>
      )}

      {variant === 'text' && Array.from({ length: rows }, (_, i) => (
        <span
          key={i}
          className={`es-skeleton es-skeleton--line ${i === rows - 1 ? 'w-2/5' : 'w-full'}`}
        />
      ))}
    </div>
  );
}

/**
 * Nothing here yet.
 *
 * `action` is a prop rather than optional decoration because an empty state
 * without one is a dead end — several of the sixteen hand-rolled versions were
 * exactly that. It is still allowed to be absent (a filtered list that matched
 * nothing has no action but "change the filter"), which is why `hint` exists.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT TAKES EITHER SHAPE, AND THAT IS A FIX RATHER THAN A CONVENIENCE.
 *
 * `{ href, label }` is the shape this was written for. But a caller that wanted
 * a PRIMARY button instead of the secondary one here had no way to ask, so
 * `/account/tickets` passed a ready-made `<Link>` element — and this component
 * read `action.href` and `action.label` off a React element, where both are
 * `undefined`. The buyer's "No tickets yet" screen rendered a button with no
 * words in it pointing at nothing: the one empty state in the product that a
 * paying customer sees, and the only way out of it was broken.
 *
 * Rather than correct that one call site and leave the trap, the prop now
 * accepts what people were already passing: an element is rendered as given, an
 * object becomes the link it describes.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function Empty({ title, hint, action }) {
  return (
    <div className="es-empty">
      <p className="text-lg text-muted">{title}</p>
      {hint && <p className="text-sm text-subtle">{hint}</p>}
      {isElement(action) ? action : action?.href ? (
        <Link href={action.href} className="es-btn es-btn--secondary es-btn--sm">
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

/**
 * A React element, as opposed to the `{ href, label }` descriptor.
 *
 * `isValidElement` from React would do it, and importing React into a file that
 * currently needs nothing from it to distinguish two prop shapes is a heavier
 * answer than the question. An element always carries `$$typeof`; a plain
 * object literal written at a call site never does.
 */
function isElement(value) {
  return Boolean(value) && typeof value === 'object' && '$$typeof' in value;
}

/**
 * Something the reader should know, in one of four tones.
 *
 * The first child takes the full-contrast ink from `.es-notice > :first-child`,
 * so `title` and `children` are separate props rather than one blob — the
 * distinction between the claim and its explanation is structural here, not a
 * matter of how the caller happens to write the sentence.
 *
 * @param {'neutral'|'info'|'warning'|'danger'} [tone]
 */
const TONES = {
  neutral: '',
  info: 'es-notice--info',
  warning: 'es-notice--warning',
  danger: 'es-notice--danger',
};

export function Notice({ tone = 'neutral', title, children, action, onRetry, retryLabel = 'Try again' }) {
  return (
    <div
      className={`es-notice ${TONES[tone] || ''}`}
      /* `alert` interrupts and is right for a failure; `status` waits its turn
         and is right for everything else. A warning banner that always sat on
         the page announcing itself as an alert on every render is noise that
         teaches people to ignore alerts. */
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      {title && <p>{title}</p>}
      {children}
      {(onRetry || action) && (
        <div className="es-notice__actions">
          {onRetry && (
            <button type="button" onClick={onRetry} className="es-btn es-btn--secondary es-btn--sm">
              {retryLabel}
            </button>
          )}
          {action && (
            <Link href={action.href} className="text-sm text-accent hover:text-accent-hover">
              {action.label} <span aria-hidden>→</span>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A failure, described.
 *
 * Runs the error through `describeError` so the two halves — what happened and
 * what to do — arrive already separated. Every call site was doing this by
 * hand, and several rendered only `title`, which tells somebody a request
 * failed and nothing about whether they can retry.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `onRetry` — AND IT WAS ALREADY BEING PASSED.
 *
 * Two call sites in the admin content editor wrote `onRetry={reload}` against a
 * component that had no such prop. React drops an unknown prop on a function
 * component in silence, so the button never existed and nothing ever said so.
 *
 * The wider problem is the one that made them reach for it. `useApi` hands back
 * a `reload` at every one of these call sites, and almost none of them offered
 * it: a dashboard whose request failed — a dropped connection, a request that
 * beat a cold server — rendered a sentence and stopped. The only way forward
 * was to reload the whole document, which a person has to think of, and which
 * on the organizer console throws away the sidebar and the scroll position to
 * re-run a request a button could have re-run in place.
 *
 * Offered whenever the caller has something to retry WITH. A screen that
 * genuinely cannot try again (a 403, a deleted event) passes `action` instead
 * and gets a way out rather than a button that fails the same way twice.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function ErrorNotice({ error, action, onRetry }) {
  const { title, recovery } = describeError(error);
  return (
    <Notice tone="danger" title={title} action={action} onRetry={onRetry}>
      <p>{recovery}</p>
    </Notice>
  );
}
