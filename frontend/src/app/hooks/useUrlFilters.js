'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * Filters that live in the URL.
 *
 * So a count on the overview can link straight into a filtered list, and the
 * back button returns to it. Four pages carried their own copy of this.
 *
 *   const { get, set, page } = useUrlFilters();
 *   get('status')            // '' when absent
 *   set('status', 'draft')   // an empty value removes the key
 *
 * Changing any filter other than `page` resets the page: page 4 of "all" is
 * rarely a page that exists in "drafts". The page component needs a <Suspense>
 * boundary, because useSearchParams does.
 */
export function useUrlFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const get = useCallback((key) => params.get(key) || '', [params]);

  const set = useCallback((key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, String(value)); else next.delete(key);
    if (key !== 'page') next.delete('page');
    // toString(), not `.size`, which Safari before 17 does not have.
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`);
  }, [params, pathname, router]);

  // Several keys in ONE navigation. Two `set` calls in a row each start from
  // the same params, so the second replace would undo the first.
  const setMany = useCallback((values) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, String(value)); else next.delete(key);
    }
    next.delete('page');
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`);
  }, [params, pathname, router]);

  const page = Math.max(1, Number(params.get('page')) || 1);

  return { get, set, setMany, page };
}
