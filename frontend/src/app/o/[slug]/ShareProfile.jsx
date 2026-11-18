'use client';

import { useState } from 'react';
import NavIcon from '../../components/shell/NavIcon';

/**
 * Share an organizer's page: the phone's own share sheet where there is one,
 * otherwise copy the link — the same choice EventShare makes for an event.
 */
export default function ShareProfile({ name, url }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({ title: `${name} on Eventsli`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Dismissing the share sheet is not an error worth showing.
    }
  }

  return (
    <button type="button" className="es-btn es-btn--secondary" onClick={share}>
      <NavIcon name={copied ? 'check' : 'share'} size={16} />
      {copied ? 'Link copied' : 'Share'}
    </button>
  );
}
