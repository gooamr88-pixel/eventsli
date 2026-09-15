'use client';

import { useState } from 'react';
import { post } from '../../utils/apiClient';
import { describeError, messageFor } from '../../utils/errors';
import { useConfirm } from '../../components/ui/Confirm';
import { useToast } from '../../components/ui/Toast';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Banning an organizer from selling — ONE implementation, used by both the
 * Organizers and the Accounts pages.
 *
 * It was written twice, with two wordings, two error styles and no busy state,
 * and NEITHER showed the one thing the API says back: how many of their events
 * are still published and selling. A ban does not pull those (BRD §19 — buyers
 * would be left holding codes for an unlisted event), so that count is exactly
 * what the admin needs to hear next.
 *
 * BANNING IS NOT BLOCKING. A banned organizer still signs in and still sees the
 * commission they owe; nothing new goes on sale.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function useOrganizerBan(onDone) {
  const confirm = useConfirm();
  const toast = useToast();
  const [busyId, setBusyId] = useState(null);

  async function toggleBan({ id, displayName, isBanned }) {
    const banning = !isBanned;
    const answer = await confirm(banning ? {
      title: `Stop ${displayName} selling?`,
      tone: 'danger',
      body: (
        <>
          <p>Nothing new goes on sale and nothing listed can be changed. They can still sign in and see what they owe.</p>
          <p>Events already on sale stay live — suspend those from each event if they must come down.</p>
        </>
      ),
      confirmLabel: 'Ban from selling',
      reason: { label: 'Why is this organizer being stopped?', minLength: 5, maxLength: 1000 },
    } : {
      title: `Let ${displayName} sell again?`,
      body: <p>Their events can be submitted and sold again.</p>,
      confirmLabel: 'Lift the ban',
    });
    if (!answer) return;

    setBusyId(id);
    try {
      const result = await post(
        `/admin/organizers/${id}/${banning ? 'ban' : 'unban'}`,
        banning ? { reason: answer.reason } : undefined,
        { noRedirect: true },
      );
      if (banning && result?.publishedEvents > 0) {
        toast.success(
          `${result.note} Find them under All events, filtered to this organizer.`,
          { title: `${displayName} can no longer sell`, duration: 12000 },
        );
      } else {
        toast.success(banning ? `${displayName} can no longer sell.` : `${displayName} can sell again.`);
      }
      onDone?.();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusyId(null);
    }
  }

  return { toggleBan, busyId };
}
