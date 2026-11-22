/**
 * The quantity pill shared by the ticket cards, the extras and the checkout's
 * add-ons: − n +, 44px targets, the number announced politely.
 */
export default function Stepper({
  value, name, onMinus, onPlus, minusDisabled, plusDisabled, plusTitle, working = false,
}) {
  return (
    <div className="es-qty" role="group" aria-label={`${name} quantity`}>
      <button type="button" onClick={onMinus} disabled={minusDisabled} aria-label={`One fewer ${name}`}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 12h12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
      </button>
      <span className="es-nums" aria-live="polite">{working ? '…' : value}</span>
      <button
        type="button"
        onClick={onPlus}
        disabled={plusDisabled}
        aria-label={`One more ${name}`}
        title={plusTitle}
        className="es-qty__plus"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 6v12M6 12h12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
      </button>
    </div>
  );
}
