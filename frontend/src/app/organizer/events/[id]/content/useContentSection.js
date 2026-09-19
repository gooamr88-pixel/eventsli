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
 * A REMOVE IS NOT UNDOABLE and nothing here pretends otherwise. Confirmation
 * before a destructive click is the caller's job, because only the caller knows
 * what the row is.
 *
 * TEXT EDITS ARE HELD AS A DRAFT AND SAVED ON A BUTTON — see `useSectionDraft`
 * below. Adding, removing and reordering are still immediate: those are single
 * deliberate clicks whose result is visible, and a Save button for them would
 * be a second click for something already decided. Typing is the opposite.
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
 * ─────────────────────────────────────────────────────────────────────────────
 * TYPED EDITS, HELD UNTIL SAVE IS PRESSED.
 *
 * WHAT THIS REPLACES. Every text field in these four sections committed on
 * BLUR: you typed, you tabbed away, and a PATCH went out. It worked, and it
 * was the wrong contract for text. Three things were wrong with it, in order
 * of how much they cost:
 *
 *   · NOTHING TOLD YOU IT HAD SAVED. The field lost focus and the row looked
 *     exactly the same whether the request had succeeded, failed, or never
 *     been sent because nothing had changed. An organizer editing a schedule
 *     had no way to know their work was kept except to reload the page.
 *   · A FAILURE WAS INVISIBLE. The error landed in a shared banner that could
 *     easily be off screen on a long list, while the field still showed the
 *     text that had not been saved.
 *   · IT SAVED THINGS NOBODY MEANT TO SAVE. Tabbing through a form to read it
 *     wrote every field it passed through.
 *
 * So typing now goes into a draft, one button commits every dirty row, and the
 * button says which of the three states it is in. The rows that were already
 * atomic — add, remove, reorder — are untouched.
 *
 * KEYED BY ROW AND FIELD so two people editing two different rows of the same
 * list produce two independent PATCHes rather than one that overwrites the
 * other's row with a stale copy.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function useSectionDraft({ items, edit }) {
  const [drafts, setDrafts] = useState({});
  // 'idle' | 'saving' | 'saved' | 'error'. `saved` is transient and reverts,
  // because a tick that stays forever stops meaning "just now".
  const [status, setStatus] = useState('idle');
  const [failure, setFailure] = useState(null);

  const setField = useCallback((id, key, value) => {
    setStatus('idle');
    setDrafts((d) => ({ ...d, [id]: { ...(d[id] || {}), [key]: value } }));
  }, []);

  /** What a field should show: the draft if it has been touched, else the row. */
  const valueOf = useCallback(
    (item, key) => (drafts[item.id] && key in drafts[item.id] ? drafts[item.id][key] : (item[key] ?? '')),
    [drafts],
  );

  /**
   * A DELETED ROW'S DRAFT IS IGNORED, not cleaned up.
   *
   * Removing a row whose edits were pending would otherwise leave a draft that
   * can never be saved and a Save button permanently lit. The obvious fix is an
   * effect that prunes the map when `items` changes — and React 19's linter
   * refuses it, correctly: that is a render painted and thrown away.
   *
   * Filtering during render is both simpler and more honest. The stale entry
   * sits in state harmlessly until the next save or discard clears it, and
   * nothing downstream can see it.
   */
  const live = items ? new Set(items.map((i) => i.id)) : null;
  const dirtyIds = Object.keys(drafts).filter((id) => !live || live.has(id));
  const dirty = dirtyIds.length > 0;

  const discard = useCallback(() => { setDrafts({}); setStatus('idle'); setFailure(null); }, []);

  const save = useCallback(async () => {
    if (!dirty || status === 'saving') return { ok: true };
    setStatus('saving');
    setFailure(null);

    /**
     * One row at a time, in order, and STOPPING at the first failure.
     *
     * Sequential rather than parallel because these are PATCHes against rows of
     * one list and the server re-sorts on some of them; firing six at once and
     * taking whichever answers last is how the list ends up in an order nobody
     * chose. Six rows is six quick requests, and this is not a hot path.
     *
     * Stopping on failure keeps the drafts for the rows that did NOT save, so
     * pressing Save again retries exactly those. Clearing everything would
     * silently discard the organizer's unsaved text.
     */
    const remaining = { ...drafts };
    for (const id of dirtyIds) {
      const answer = await edit(id, drafts[id]);
      if (!answer?.ok) {
        setDrafts(remaining);
        setFailure(answer?.error || null);
        setStatus('error');
        return { ok: false };
      }
      delete remaining[id];
    }

    setDrafts({});
    setStatus('saved');
    return { ok: true };
  }, [dirty, dirtyIds, drafts, edit, status]);

  return { setField, valueOf, dirty, save, discard, status, failure };
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
