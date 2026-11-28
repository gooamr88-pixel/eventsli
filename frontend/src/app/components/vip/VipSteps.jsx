import NavIcon from '../shell/NavIcon';
import { STATUS, STEPS } from './vipStatus';

/**
 * Where a VIP request stands (2026-11-28): Received → Reviewing → Proposal
 * sent → Confirmed → In progress → Completed. A cancelled one says so
 * instead of showing a half-done line.
 */
export default function VipSteps({ status }) {
  if (status === 'cancelled') {
    return <p className="es-vipsteps__cancelled"><NavIcon name="ban" size={16} /> This request is cancelled.</p>;
  }
  const at = STEPS.indexOf(status);
  return (
    <ol className="es-vipsteps" aria-label="Progress">
      {STEPS.map((s, i) => {
        const state = i < at || status === 'completed' ? 'done' : i === at ? 'now' : 'next';
        return (
          <li key={s} className={`is-${state}`} aria-current={state === 'now' ? 'step' : undefined}>
            <span className="es-vipsteps__dot" aria-hidden="true">{state === 'done' ? <NavIcon name="tick" size={12} /> : null}</span>
            <span className="es-vipsteps__label">{STATUS[s].label}</span>
          </li>
        );
      })}
    </ol>
  );
}
