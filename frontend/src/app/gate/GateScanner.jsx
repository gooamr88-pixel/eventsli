'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { describeError } from '../utils/errors';
import { clearSession, gateFetch, GateAuthError, useGateSession } from './gateSession';
import { useGateQueue } from './useGateQueue';
import { useScanner } from './useScanner';
import { clearAll } from './scanQueue';
import { describeScan } from './scanOutcome';
import { signalFor, primeAudio } from './feedback';
import GateBar from './GateBar';
import ScanResult from './ScanResult';
import ScanLog from './ScanLog';

/** The gate's own numbers, refreshed on a slow loop. Slow because they are
 *  context, not a decision — the scan itself is what admits anyone, and it is
 *  always asked live. */
const STATUS_MS = 60_000;

export default function GateScanner() {
  const router = useRouter();
  const session = useGateSession();
  const queue = useGateQueue(session);

  const [scanning, setScanning] = useState(false);
  const [entry, setEntry] = useState(null);
  const [status, setStatus] = useState(null);
  const [fatal, setFatal] = useState(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  // `undefined` is "not read yet" — see useGateSession. Only a definite `null`
  // means this tablet has never been signed in.
  useEffect(() => {
    if (session === null) router.replace('/gate/login');
  }, [session, router]);

  // ── The gate's state, on a loop ───────────────────────────────────────────
  useEffect(() => {
    if (!session?.token) return undefined;
    let cancelled = false;

    const load = async () => {
      try {
        const data = await gateFetch('/scan/status', { method: 'GET', cache: 'no-store' });
        if (!cancelled) setStatus(data);
      } catch (err) {
        // Offline is the normal case here and says nothing worth showing. An
        // expired token is not, and has to reach the sign-in screen.
        if (!cancelled && err instanceof GateAuthError) setFatal(err);
      }
    };

    load();
    const timer = setInterval(load, STATUS_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [session?.token, queue.admitted]);

  // ── One code, from the camera or from the keyboard ────────────────────────
  const handleCode = useCallback(async (raw) => {
    try {
      const outcome = await queue.submit(raw);
      if (!outcome) return;
      setEntry(outcome);

      const result = outcome.record.state === 'done' ? outcome.record.result : 'queued';
      // The sound is chosen from the OUTCOME's tone rather than from a branch
      // here, so a result added to the table cannot arrive with a colour and no
      // sound.
      signalFor(describeScan(result).tone);

      // A locked gate is not something to keep scanning past. Every following
      // guest gets the same refusal, and a camera left running invites the
      // operator to try it twenty more times.
      if (result === 'scanner_locked') setScanning(false);
    } catch (err) {
      if (err instanceof GateAuthError) setFatal(err);
      else setEntry({ record: { state: 'done', result: 'error' }, error: err });
    }
  }, [queue]);

  const scanner = useScanner({ active: scanning, onDecode: handleCode });

  async function signOut() {
    if (queue.queued === 0) {
      // Nothing is owed to the server, so the shift log can go with the shift.
      // With anything pending this branch is not taken: an unsent scan is the
      // only copy of somebody's admission.
      await clearAll().catch(() => {});
    }
    clearSession();
    router.replace('/gate/login');
  }

  if (session === undefined) {
    return <main className="fx-gutter fx-section"><p className="text-subtle">Opening…</p></main>;
  }
  if (session === null) return null;

  if (fatal) {
    return (
      <main className="fx-container fx-container--xs fx-gutter fx-section fx-stack">
        <h1 className="text-xl text-ink">{describeError(fatal).title}</h1>
        <p className="text-muted">{describeError(fatal).recovery}</p>
        <p className="text-sm text-muted">
          {queue.queued > 0
            ? `${queue.queued} scan(s) are still held on this device. They are not lost — sign the device in again and they upload by themselves.`
            : 'Nothing is waiting to upload.'}
        </p>
        <button
          type="button"
          onClick={() => router.replace('/gate/login')}
          className="self-start rounded-(--es-radius-md) bg-accent px-4 py-3 text-base font-medium text-on-accent"
        >
          Sign this device in again
        </button>
      </main>
    );
  }

  return (
    <main className="fx-stack fx-stack--sm">
      <GateBar
        session={session}
        status={status}
        queued={queue.queued}
        syncing={queue.syncing}
        online={queue.online}
        lastSync={queue.lastSync}
        onSync={() => queue.sync().catch(() => {})}
        onSignOut={() => setConfirmSignOut(true)}
      />

      <div className="fx-container fx-container--sm fx-gutter fx-stack fx-safe-bottom">
        {/* The reader element must exist in the DOM before the engine is told to
            start, and it must have a real size — a hidden one measures zero and
            the camera refuses to open. So it is mounted with the camera, not
            hidden alongside it. */}
        {scanning && (
          <div className="fx-stack fx-stack--sm">
            <div
              id={scanner.readerId}
              className="overflow-hidden rounded-(--es-radius-lg) bg-black"
            />
            <div className="fx-row fx-row--between">
              <button
                type="button"
                onClick={() => setScanning(false)}
                className="rounded-(--es-radius-md) border border-border-strong px-4 py-2.5 text-sm text-ink"
              >
                Stop the camera
              </button>
              {scanner.torch.available && (
                <button
                  type="button"
                  onClick={scanner.toggleTorch}
                  aria-pressed={scanner.torch.on}
                  className="rounded-(--es-radius-md) border border-border-strong px-4 py-2.5 text-sm text-ink"
                >
                  {scanner.torch.on ? 'Light off' : 'Light on'}
                </button>
              )}
            </div>
            {scanner.status === 'starting' && (
              <p className="text-sm text-subtle">Asking for the camera…</p>
            )}
            {scanner.error && (
              <p role="alert" className="rounded-(--es-radius-md) bg-danger/10 px-3 py-2 text-sm text-danger">
                {scanner.error}
              </p>
            )}
          </div>
        )}

        {!scanning && (
          <button
            type="button"
            onClick={() => { primeAudio(); setScanning(true); }}
            className="rounded-(--es-radius-lg) bg-accent px-4 py-5 text-lg font-medium text-on-accent"
          >
            Start scanning
          </button>
        )}

        <ScanResult
          entry={entry}
          onUndo={queue.undo}
          onDismiss={() => setEntry(null)}
        />

        <ManualEntry onSubmit={handleCode} />

        <div className="fx-stack fx-stack--sm">
          <h2 className="text-sm uppercase tracking-[0.14em] text-subtle">This device</h2>
          <ScanLog records={queue.records} />
        </div>

        {queue.storageError && (
          <p className="rounded-(--es-radius-md) bg-danger/10 px-3 py-2 text-sm text-danger">
            This browser will not store scans offline, so every scan needs a connection.
            Private browsing is the usual cause.
          </p>
        )}
      </div>

      {confirmSignOut && (
        <div className="fx-container fx-container--sm fx-gutter">
          <div className="fx-stack fx-stack--sm rounded-(--es-radius-lg) border border-border-strong bg-surface p-4">
            <p className="text-ink">Sign this device out?</p>
            <p className="text-sm text-muted">
              {queue.queued > 0
                ? `${queue.queued} scan(s) have not reached the server yet. They stay on this device and upload when it is signed in again — but nobody else can see them until then.`
                : 'Everything scanned here has been uploaded. The shift log on this device will be cleared.'}
            </p>
            <div className="fx-row fx-row--between">
              <button
                type="button"
                onClick={() => setConfirmSignOut(false)}
                className="text-sm text-muted hover:text-ink"
              >
                Stay signed in
              </button>
              <button
                type="button"
                onClick={signOut}
                className="rounded-(--es-radius-md) bg-danger px-4 py-2.5 text-sm font-medium text-white"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/**
 * The way in when the camera will not open — a cracked lens, a refused
 * permission, a code that will not read off a shattered screen. A door with no
 * fallback is a door that stops.
 */
function ManualEntry({ onSubmit }) {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start text-sm text-muted underline decoration-dotted hover:text-ink"
      >
        Type a code instead
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(value.trim()); setValue(''); }}
      className="fx-stack fx-stack--sm"
    >
      <label htmlFor="gate-manual" className="text-sm text-ink">Ticket code</label>
      <textarea
        id="gate-manual"
        rows={3}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Paste the code, or the ticket link"
        autoCapitalize="off"
        spellCheck={false}
        className="fx-break rounded-(--es-radius-md) border border-border-strong bg-surface px-3 py-2 font-mono text-sm text-ink"
      />
      <div className="fx-row fx-row--between">
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-muted hover:text-ink">
          Close
        </button>
        <button
          type="submit"
          disabled={value.trim().length < 10}
          className="rounded-(--es-radius-md) bg-accent px-4 py-2.5 text-sm font-medium text-on-accent disabled:opacity-40"
        >
          Check it
        </button>
      </div>
    </form>
  );
}
