import { useCallback, useState } from 'react';
import { post } from '../../utils/apiClient';
import { messageFor } from '../../utils/errors';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Sign, PUT, confirm.
 *
 * The bytes never pass through the Eventsli API and the browser never holds a
 * Supabase key. The server invents the object key and signs an upload for
 * exactly that key; the browser PUTs straight to storage; the server then
 * confirms the object landed before any row is written. Same three steps as an
 * event cover — see `backend/services/siteMediaService.js` for why.
 *
 * STEP 2 IS A BARE `fetch`, not `apiClient`. The signed URL is Supabase's, not
 * ours: `apiClient` would prefix it with our API base, attach our credentials,
 * and try to parse the response as our envelope. All three would be wrong.
 *
 * `credentials` is deliberately omitted so the browser sends no cookies to
 * storage — the signature in the URL is the whole authorisation.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function useUpload(scope) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  /**
   * @param {File} file
   * @returns {Promise<{url: string, path: string}|null>} null on failure — the
   *   caller reads `error` for the message rather than catching, so a cancelled
   *   upload does not have to be an exception at every call site.
   */
  const upload = useCallback(async (file) => {
    if (!file) return null;
    setBusy(true);
    setError(null);

    try {
      const signed = await post('/admin/storefront/uploads/sign', {
        scope,
        contentType: file.type,
      });

      const response = await fetch(signed.uploadUrl, {
        method: 'PUT',
        // The only header. The token is already inside the URL, and adding
        // anything else makes the signature no longer match what was signed.
        headers: { 'Content-Type': file.type },
        body: file,
      });

      if (!response.ok) {
        // The bucket's own size and type limits are enforced here, during the
        // PUT, which our API never sees. Without this branch that refusal is
        // silent and the confirm step reports "not uploaded" instead.
        throw new Error(
          response.status === 413
            ? 'That file is too large for the bucket.'
            : `Storage refused the upload (${response.status}).`,
        );
      }

      return await post('/admin/storefront/uploads/confirm', { scope, path: signed.path });
    } catch (err) {
      // The two `throw new Error` above carry real sentences and `messageFor`
      // keeps them; what it changes is the API-shaped failures, where the raw
      // message is the bare code or, offline, nothing at all.
      setError(messageFor(err));
      return null;
    } finally {
      setBusy(false);
    }
  }, [scope]);

  return { upload, busy, error, clearError: () => setError(null) };
}

/**
 * The types the bucket accepts, as an `accept` attribute.
 *
 * Kept beside the upload rather than typed into each <input>: the list exists
 * in three places already (the bucket's `allowed_mime_types`, the route's
 * validator, `siteMediaService.EXTENSION_FOR`) and a fourth copy that drifts
 * means a file picker that offers a type the server will refuse.
 */
export const ACCEPTED_IMAGES = 'image/jpeg,image/png,image/webp,image/svg+xml';
