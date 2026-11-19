'use client';

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import NavIcon from '../shell/NavIcon';
import { FieldLabel } from './Field';
import { BY_ISO, flagSrc, joinPhone, localeCountry, searchCountries, splitPhone } from '../../lib/phoneInput';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A phone number with its country (owner, 2026-11-19): "real flags of
 * countries as professional SVGs with their beginning numbers".
 *
 * The flag and calling code open a searchable list of every country (by
 * name, code or "+20"); the box beside takes the number as dialled at home.
 * The form receives one international value, "+20 100 123 4567".
 *
 * The country starts as: the one in the value → `defaultCountry` (an event's
 * country) → the visitor's browser region → the US. The browser region is read
 * through useSyncExternalStore, so the server's HTML and the first client
 * paint agree and the region arrives right after hydration.
 *
 * Flags are the site's own SVGs (/flags, country-flag-icons, MIT): an <img>
 * each, lazily loaded, so the list costs nothing until it is opened.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const noSubscribe = () => () => {};
const browserLanguages = () => (typeof navigator !== 'undefined' ? (navigator.languages || [navigator.language]).join(',') : '');

export function PhoneInput({
  id, value, onChange, defaultCountry = null, required = false, placeholder, invalid = false, describedBy, name, autoComplete = 'tel-national',
}) {
  const langs = useSyncExternalStore(noSubscribe, browserLanguages, () => '');
  const guessed = localeCountry(langs ? langs.split(',') : []);
  const [picked, setPicked] = useState(null);
  const fallback = picked || (defaultCountry && BY_ISO.has(defaultCountry) ? defaultCountry : null) || guessed || 'US';

  // The national part, from the value — re-read whenever the value changes
  // from OUTSIDE (a "Use my details" button), during render, not in an effect.
  // `seen` is the last value we emitted or were given; our own typing never
  // re-splits. `valueIso` is set only by a "+…" value, never by the fallback,
  // so the browser's region can still take over after hydration.
  const [seen, setSeen] = useState(value);
  const [national, setNational] = useState(() => splitPhone(value, null).national);
  const [valueIso, setValueIso] = useState(() => splitPhone(value, null).iso);
  if (value !== seen) {
    setSeen(value);
    const s = splitPhone(value, picked || valueIso);
    setNational(s.national);
    if (s.iso) setValueIso(s.iso);
  }
  const iso = picked || valueIso || fallback;
  const country = BY_ISO.get(iso);

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef(null);
  const search = useRef(null);
  const listId = useId();
  const results = useMemo(() => searchCountries(q), [q]);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    search.current?.focus();
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  function emit(nextIso, nextNational) {
    const out = joinPhone(nextIso, nextNational);
    setSeen(out);
    onChange(out);
  }
  function choose(nextIso) {
    setPicked(nextIso);
    setValueIso(nextIso);
    setOpen(false);
    setQ('');
    emit(nextIso, national);
    box.current?.querySelector('input[type="tel"]')?.focus();
  }
  function onListKey(e) {
    const items = [...(box.current?.querySelectorAll('.es-telfield__option') || [])];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(items.length - 1, i + 1)]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); (i <= 0 ? search.current : items[i - 1])?.focus(); }
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); box.current?.querySelector('.es-telfield__country')?.focus(); }
  }

  return (
    <div className="es-telfield" ref={box} data-invalid={invalid || undefined}>
      <button
        type="button"
        className="es-telfield__country"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`Country: ${country?.name || iso}, +${country?.dial || ''}. Change`}
        onClick={() => setOpen((o) => !o)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a 3 KB local SVG; next/image adds nothing for it */}
        <img src={flagSrc(iso)} alt="" width={24} height={16} className="es-telfield__flag" />
        <span className="es-telfield__dial">+{country?.dial}</span>
        <NavIcon name="chevronDown" size={16} />
      </button>
      <input
        id={id}
        name={name}
        type="tel"
        inputMode="tel"
        autoComplete={autoComplete}
        className="es-telfield__number"
        required={required}
        placeholder={placeholder}
        maxLength={20}
        aria-invalid={invalid ? 'true' : undefined}
        aria-describedby={describedBy}
        value={national}
        onChange={(e) => {
          const typed = e.target.value;
          // A whole international number typed or pasted ("+20 100…"): its
          // code picks the country, and the rest stays in the box.
          if (typed.trim().startsWith('+')) {
            const s = splitPhone(typed, iso);
            if (s.iso) {
              setPicked(s.iso);
              setValueIso(s.iso);
              setNational(s.national);
              emit(s.iso, s.national);
              return;
            }
          }
          setNational(typed);
          emit(iso, typed);
        }}
      />

      {open && (
        <div className="es-telfield__menu" onKeyDown={onListKey}>
          <div className="es-telfield__search">
            <NavIcon name="search" size={16} />
            <input ref={search} type="search" aria-label="Search countries" placeholder="Search country or code"
              value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); if (results[0]) choose(results[0].iso); }
                if (e.key === 'ArrowDown') { e.preventDefault(); box.current?.querySelector('.es-telfield__option')?.focus(); }
              }} />
          </div>
          <ul id={listId} role="listbox" aria-label="Countries" className="es-telfield__list">
            {results.map((c) => (
              <li key={c.iso} role="presentation">
                <button type="button" role="option" aria-selected={c.iso === iso} className="es-telfield__option" onClick={() => choose(c.iso)}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- local SVG flag, lazily loaded */}
                  <img src={flagSrc(c.iso)} alt="" width={24} height={16} loading="lazy" decoding="async" className="es-telfield__flag" />
                  <span className="es-telfield__name">{c.name}</span>
                  <span className="es-telfield__code">+{c.dial}</span>
                </button>
              </li>
            ))}
            {results.length === 0 && <li className="es-telfield__none">No country matches “{q}”.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The labelled field: label, the phone input, a hint or an error. */
export default function PhoneField({ label, hint, error, optional = false, required = false, ...props }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className="fx-stack fx-stack--sm gap-1.5">
      <FieldLabel htmlFor={id} required={required} optional={optional}>{label}</FieldLabel>
      <PhoneInput id={id} required={required} invalid={Boolean(error)}
        describedBy={[hint && !error && hintId, error && errorId].filter(Boolean).join(' ') || undefined} {...props} />
      {hint && !error && <p id={hintId} className="text-xs text-subtle">{hint}</p>}
      {error && <p id={errorId} className="text-xs text-danger">{error}</p>}
    </div>
  );
}
