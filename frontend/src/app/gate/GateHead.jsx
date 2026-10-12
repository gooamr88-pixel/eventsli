import Logo from '../components/brand/Logo';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE GATE'S MASTHEAD — which the gate did not have.
 *
 * `SiteHeader` returns null under /gate, for a good reason: the gate's
 * principal is a device with a PIN, and a header offering "Sign in", "My
 * tickets" and a browse menu is a header offering a door tablet somewhere else
 * to go. That reason covers the NAVIGATION. It was taken to cover the brand as
 * well, so the door — the one screen a guest leans over and reads upside down —
 * carried no logo, no colour and nothing identifying whose product it was.
 *
 * This is the masthead without the navigation: the mark, the wordmark, and a
 * word saying which screen this is. Nothing in it is a link. There is nowhere
 * for a gate to go, and a logo that navigates would be a way to lose the
 * scanner mid-queue by tapping the thing at the top of the screen.
 *
 * `right` carries whatever this particular screen needs beside it — the online
 * pill and sign-out on the scanner, nothing at all on the sign-in page.
 * ─────────────────────────────────────────────────────────────────────────────
 */
/*
 * NO `fx-safe-top` ON THE <header>. `.fx-gate__head` folds the notch inset
 * into its own padding, because both write `padding-top`, the component rule
 * is later in globals.css, and at equal specificity later wins — composing the
 * two would silently drop the inset. See the note beside it in globals.css.
 */
export default function GateHead({ right = null, children = null }) {
  return (
    <header className="fx-gate__head">
      <div className="fx-row fx-min0 gap-2">
        {/* `sm`: a masthead, not a hero. The wordmark at `md` next to a queue
            counter is a logo competing with the number the operator is here
            to read. */}
        <Logo size="sm" />
        <span className="fx-gate__badge">Gate</span>
        {children}
      </div>
      {right}
    </header>
  );
}
