'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { get } from '../utils/apiClient';
import { categoryLabel } from '../lib/categories';

/**
 * The enabled event categories, with the labels the admin gave them — fetched
 * once per page load and shared by every screen that offers or names one (the
 * create-event wizard, the event editor, the submit review).
 *
 * `[]` until it answers, and on failure: callers fall back to
 * `lib/categories` for names and keep whatever value they already hold.
 */
let state = { status: 'idle', list: [] };
const listeners = new Set();
const emit = () => { for (const l of listeners) l(); };
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const snapshot = () => state;
const SERVER = Object.freeze({ status: 'idle', list: [] });

async function load() {
  if (state.status !== 'idle') return;
  state = { status: 'loading', list: [] };
  try {
    const data = await get('/public/event-categories', { noRedirect: true });
    state = { status: 'ready', list: Array.isArray(data?.labelled) ? data.labelled : [] };
  } catch {
    state = { status: 'failed', list: [] };
  }
  emit();
}

export function useCategories() {
  const current = useSyncExternalStore(subscribe, snapshot, () => SERVER);
  useEffect(() => { load(); }, []);
  return {
    list: current.list,
    ready: current.status === 'ready',
    label: (slug) => categoryLabel(slug, current.list),
  };
}

/** Tests only. */
export function resetCategoriesForTests() { state = { status: 'idle', list: [] }; }
