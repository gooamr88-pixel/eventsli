'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { get } from '../utils/apiClient';
import { COUNTRY_OPTIONS } from '../lib/markets';

/**
 * The countries an organizer can choose right now — the markets a super admin
 * has open in platform settings (`GET /public/markets`) — as `<select>`
 * options. Fetched once per page load and shared by every country picker.
 *
 * Until it answers, and if it fails, every supported country is offered: the
 * API still refuses a closed market on submit, so the fallback is a form that
 * says no late rather than one with nothing to pick.
 */
let state = { status: 'idle', countries: null };
const listeners = new Set();
const emit = () => { for (const l of listeners) l(); };
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const snapshot = () => state;
const SERVER = Object.freeze({ status: 'idle', countries: null });

async function load() {
  if (state.status !== 'idle') return;
  state = { status: 'loading', countries: null };
  try {
    const data = await get('/public/markets', { noRedirect: true });
    state = { status: 'ready', countries: Array.isArray(data?.countries) ? data.countries : null };
  } catch {
    state = { status: 'failed', countries: null };
  }
  emit();
}

export function useOpenCountries() {
  const current = useSyncExternalStore(subscribe, snapshot, () => SERVER);
  useEffect(() => { load(); }, []);
  const open = current.countries;
  const options = open ? COUNTRY_OPTIONS.filter(([code]) => open.includes(code)) : COUNTRY_OPTIONS;
  return { options, ready: current.status === 'ready' && Array.isArray(open) };
}

/**
 * The country a form should hold once the open list is known: the one it has
 * if that is still open, otherwise the first open one. `null` when nothing is
 * open (the form keeps its value and the API explains on submit).
 */
export function openCountryFor(current, options) {
  if (options.some(([code]) => code === current)) return current;
  return options[0]?.[0] ?? null;
}

/** Tests only. */
export function resetOpenCountriesForTests() { state = { status: 'idle', countries: null }; }
