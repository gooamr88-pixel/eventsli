'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useConfirm } from '../../../../components/ui/Confirm';

/**
 * Asks before an unsaved map is thrown away.
 *
 * The editor holds the whole room in memory until Save, and nothing stopped a
 * click on the sidebar — or closing the tab — from discarding an afternoon of
 * layout without a word.
 *
 * Two exits are covered. Closing or reloading the tab gets the browser's own
 * prompt (`beforeunload`; browsers do not allow custom text there). Following a
 * link inside the app is intercepted in the capture phase, before Next's Link
 * handles it, and asks with the app's own dialog.
 */
export function useUnsavedGuard(dirty) {
  const router = useRouter();
  const confirm = useConfirm();

  useEffect(() => {
    if (!dirty) return undefined;

    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };

    const onClick = async (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = e.target instanceof Element ? e.target.closest('a[href]') : null;
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;

      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;

      e.preventDefault();
      e.stopPropagation();
      const leave = await confirm({
        title: 'Leave without saving the map?',
        tone: 'danger',
        body: <p>Your changes to the map have not been saved. Leaving now discards them.</p>,
        confirmLabel: 'Leave without saving',
      });
      if (leave) router.push(`${url.pathname}${url.search}${url.hash}`);
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, confirm, router]);
}
