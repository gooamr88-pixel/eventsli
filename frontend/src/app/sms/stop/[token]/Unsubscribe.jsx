'use client';

import { useState } from 'react';
import Link from 'next/link';
import { post } from '../../../utils/apiClient';
import { messageFor } from '../../../utils/errors';
import Logo from '../../../components/brand/Logo';
import NavIcon from '../../../components/shell/NavIcon';

/**
 * The opt-out link in a marketing text sent from an alphanumeric sender ID
 * (which cannot receive a STOP reply).
 *
 * A BUTTON, not a GET: link scanners and message previews open every URL in a
 * text, and an unsubscribe that fired on page load would opt people out of
 * messages they never saw.
 */
export default function Unsubscribe({ token }) {
  const [state, setState] = useState({ step: 'ask' });

  async function stop() {
    setState({ step: 'busy' });
    try {
      const r = await post('/sms/unsubscribe', { token }, { noRedirect: true });
      setState({ step: 'done', phone: r.phone });
    } catch (err) {
      setState({ step: 'error', message: messageFor(err) });
    }
  }

  return (
    <main className="fx-section fx-section--sm">
      <div className="fx-container fx-container--xs fx-gutter fx-stack">
        <Link href="/" aria-label="Eventsli home"><Logo /></Link>
        <section className="es-card fx-stack p-6">
          {state.step === 'done' ? (
            <>
              <h1 className="text-2xl font-bold text-ink"><NavIcon name="check" size={24} /> You will not get offers by text.</h1>
              <p className="text-muted">Marketing texts to {state.phone} have stopped. You will still get texts about tickets you buy, unless you reply STOP to one of them.</p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-ink">Stop offers by text?</h1>
              <p className="text-muted">Eventsli will stop sending promotional texts to this number. Messages about tickets you have bought are not affected.</p>
              {state.step === 'error' && <p role="alert" className="text-danger">{state.message}</p>}
              <div>
                <button type="button" className="es-btn es-btn--primary" disabled={state.step === 'busy'} onClick={stop}>
                  Stop marketing texts
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
