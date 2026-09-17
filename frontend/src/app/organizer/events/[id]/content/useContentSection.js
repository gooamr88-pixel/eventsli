'use client';

import { useCallback, useEffect, useState } from 'react';
import { get, post, patch, put, del } from '../../../../utils/apiClient';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * One of the event's content collections — gallery, sponsors, policies,
 * schedule — loaded and edited.
 *
 * Four sections that behave identically: list, add, edit, reorder, remove. One
 * hook rather than four copies, for the same reason the API has one service
 * behind four routes — four copies is four places for "does the list refresh
 * after a delete" to be answered differently.
 *
 *
 * THE LIST IS THE SERVER'S ANSWER, NOT A LOCAL GUESS.
 *
 * Every mutation replaces the row it changed with what came back, rather than
 * patching the local copy with what was sent. The two differ more often than
 * they look like they would: the server trims, truncates, assigns the id, and
 * for a sponsor logo returns a completely different URL from the one the client
 * knows about. A locally-patched row is right until the first time it is not,
 * and then it is wrong until a reload nobody performs.
 *
 * A REMOVE IS NOT UNDOABLE and nothing here pretends otherwise. There is no
 * draft, no Save button and no history: each edit is a request. That is the
 * opposite of the seat map next door, and deliberately — a seat map is stock
 * somebody paid for and is saved as one atomic replace, while a sponsor logo
 * costs a re-upload. Confirmation before a destructive click is the caller's
 * job, because only the caller knows what the row is.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function useContentSection(eventId, section) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  const base = `/events/${eventId}/${section}`;

  /**
   * The load, written the way `useApi` writes it, and for its reasons.
   *
   * The fetch is an IIFE inside the effect with a `cancelled` flag rather than
   * a `reload()` call, so no state is set synchronously in the effect body —
   * which React's compiler refuses, and which would also drop a slow response
   * for the previous section onto the next one.
   *
   * `reload` is a version bump rather than the fetch itself, so callers cannot
   * start one outside the effect that owns cancelling it.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await get(base, { cache: 'no-store' });
        if (!cancelled) {
          setItems(Array.isArray(data) ? data : []);
          setError(null);
        }
      } catch (err) {
        // `items` is left as it was rather than emptied: an empty list renders
        // "nothing here yet", which is a different and wrong thing to tell
        // somebody whose sponsors failed to load.
        if (!cancelled) setError(err);
      }
    })();
    return () => { cancelled = true; };
  }, [base, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  /** Wraps a mutation so every one of them reports the same way. */
  const run = useCallback(async (fn) => {
    setBusy(true);
    setError(null);
    try {
      const result = await fn();
      return { ok: true, result };
    } catch (err) {
      setError(err);
      return { ok: false, error: err };
    } finally {
      setBusy(false);
    }
  }, []);

  const add = useCallback((body) => run(async () => {
    const created = await post(base, body, { noRedirect: true });
    setItems((list) => [...(list || []), created]);
    // Then re-read, because the server decides the order: a sponsor lands by
    // LEVEL, not at the end of the list, so the optimistic append above is
    // right about the content and can be wrong about the position.
    reload();
    return created;
  }), [base, run, reload]);

  const edit = useCallback((id, body) => run(async () => {
    const updated = await patch(`${base}/${id}`, body, { noRedirect: true });
    setItems((list) => (list || []).map((i) => (i.id === id ? updated : i)));
    return updated;
  }), [base, run]);

  const remove = useCallback((id) => run(async () => {
    await del(`${base}/${id}`, { noRedirect: true });
    setItems((list) => (list || []).filter((i) => i.id !== id));
    return { id };
  }), [base, run]);

  /**
   * Moves one item one place, and writes the whole resulting order.
   *
   * The list moves on screen FIRST and the request follows. Reordering is a
   * repeated click — an organizer moves something up three times — and waiting
   * for a round trip between each makes the button feel broken and the third
   * click land on a row that has not moved yet. A failure re-reads and puts
   * everything back where the server says it is.
   */
  const move = useCallback((id, delta) => {
    let next = null;
    setItems((list) => {
      const current = list || [];
      const from = current.findIndex((i) => i.id === id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= current.length) return current;
      next = [...current];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });

    if (!next) return Promise.resolve({ ok: true });
    return run(async () => {
      try {
        return await put(`${base}/order`, { ids: next.map((i) => i.id) }, { noRedirect: true });
      } catch (err) {
        // Put everything back where the server says it is, rather than leaving
        // the screen showing an order that was never saved.
        reload();
        throw err;
      }
    });
  }, [base, run, reload]);

  return { items, error, busy, reload, add, edit, remove, move, setError };
}

/**
 * Uploads one image and returns the storage `path` to attach to a row.
 *
 * THREE STEPS, AND THE BYTES NEVER PASS THROUGH OUR API. The server signs a URL
 * for one object key IT chose, the browser PUTs straight to that URL, and the
 * caller sends the path back with whatever row it is creating. The client never
 * picks the path and could not use one if it did — which is what stops a row
 * from pointing at somebody else's object, or at any address on the internet.
 *
 * The size is checked here as well as by the bucket, because the bucket refuses
 * during the PUT and the row-creating request never sees that — without this,
 * "too large" reads as "the upload silently did nothing".
 */
export async function uploadImage(eventId, file, kind = 'gallery') {
  const signed = await post(`/events/${eventId}/content/upload`, {
    contentType: file.type, kind,
  }, { noRedirect: true });

  if (file.size > signed.maxBytes) {
    throw Object.assign(new Error(
      `That image is ${(file.size / 1048576).toFixed(1)} MB. The limit is `
      + `${Math.round(signed.maxBytes / 1048576)} MB.`,
    ), { code: 'VALIDATION_ERROR' });
  }

  const uploaded = await fetch(signed.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!uploaded.ok) {
    throw Object.assign(new Error('The image did not upload. Try again.'), { code: 'CONFLICT' });
  }

  return signed.path;
}

/** What the upload endpoints accept. Stated once so the file picker and the
 *  error message cannot disagree with the server. */
export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';
