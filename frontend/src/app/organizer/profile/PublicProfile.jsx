'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { get, patch, post, put } from '../../utils/apiClient';
import { useToast } from '../../components/ui/Toast';
import Field from '../../components/forms/Field';
import FormError from '../../components/forms/FormError';
import SubmitButton from '../../components/forms/SubmitButton';
import NavIcon from '../../components/shell/NavIcon';
import { downscale } from '../events/[id]/map/studio/uploadStudioImage';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The organizer's public page — what buyers see at /o/<address> (2026-11-18).
 *
 * Every field is optional and nothing is filled in for them: a blank contact
 * field is simply not shown. Their account email is never published. The
 * address is made from their brand name once; changing it here moves the page
 * (old links stop working), which the hint says.
 *
 * Saved separately from "Organization details" on purpose: these columns come
 * from migration 20261127090000, and a server without it answers this section
 * with FEATURE_DISABLED while the rest of the profile keeps working.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const NETWORKS = [
  ['instagram', 'Instagram', '@yourbrand'],
  ['facebook', 'Facebook', 'yourpage'],
  ['tiktok', 'TikTok', '@yourbrand'],
  ['x', 'X', '@yourbrand'],
  ['youtube', 'YouTube', '@yourchannel'],
  ['linkedin', 'LinkedIn', 'your-company'],
];

function fromProfile(p) {
  return {
    slug: p?.slug || '',
    publicEmail: p?.contact?.email || '',
    publicPhone: p?.contact?.phone || '',
    website: p?.contact?.website || '',
    ...Object.fromEntries(NETWORKS.map(([k]) => [`s_${k}`, p?.socialLinks?.[k] || ''])),
  };
}

export default function PublicProfile() {
  const toast = useToast();
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState(() => fromProfile(null));
  const [state, setState] = useState({ loading: true, unavailable: false, busy: false, logoBusy: false, error: null });
  const fileRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await get('/organizer/public-profile', { noRedirect: true });
        if (cancelled) return;
        setProfile(p);
        setForm(fromProfile(p));
        setState((s) => ({ ...s, loading: false }));
      } catch (err) {
        if (cancelled) return;
        setState((s) => ({ ...s, loading: false, unavailable: err?.code === 'FEATURE_DISABLED', error: err?.code === 'FEATURE_DISABLED' ? null : err }));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const original = fromProfile(profile);
  const changed = Object.keys(form).filter((k) => form[k].trim() !== original[k]);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setState((s) => ({ ...s, busy: true, error: null }));
    const body = {};
    for (const k of changed) {
      if (k.startsWith('s_')) body.social = { ...(body.social || {}), [k.slice(2)]: form[k].trim() };
      else body[k] = form[k].trim();
    }
    try {
      const p = await patch('/organizer/public-profile', body, { noRedirect: true });
      setProfile(p);
      setForm(fromProfile(p));
      toast?.success?.('Public profile saved');
      setState((s) => ({ ...s, busy: false }));
    } catch (err) {
      setState((s) => ({ ...s, busy: false, error: err }));
    }
  }

  async function chooseLogo(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setState((s) => ({ ...s, logoBusy: true, error: null }));
    try {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
        throw Object.assign(new Error('Choose a JPEG, PNG or WebP image.'), { code: 'VALIDATION_ERROR' });
      }
      // A logo is shown at most a few hundred pixels across.
      const blob = await downscale(file, { width: 800, height: 800, quality: 0.9 });
      const signed = await post('/organizer/public-profile/logo-upload', { contentType: blob.type }, { noRedirect: true });
      if (blob.size > signed.maxBytes) {
        throw Object.assign(new Error('That image is too large, even after resizing.'), { code: 'VALIDATION_ERROR' });
      }
      const up = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'Content-Type': blob.type }, body: blob });
      if (!up.ok) throw Object.assign(new Error('The image did not upload. Try again.'), { code: 'CONFLICT' });
      const p = await put('/organizer/public-profile/logo', { path: signed.path }, { noRedirect: true });
      setProfile(p);
      setState((s) => ({ ...s, logoBusy: false }));
    } catch (err) {
      setState((s) => ({ ...s, logoBusy: false, error: err }));
    }
  }

  async function removeLogo() {
    setState((s) => ({ ...s, logoBusy: true, error: null }));
    try {
      const p = await put('/organizer/public-profile/logo', { path: null }, { noRedirect: true });
      setProfile(p);
      setState((s) => ({ ...s, logoBusy: false }));
    } catch (err) {
      setState((s) => ({ ...s, logoBusy: false, error: err }));
    }
  }

  return (
    <section className="es-dcard" aria-labelledby="org-public">
      <div className="es-tilehead">
        <span className="es-paytile" aria-hidden="true"><NavIcon name="globe" size={24} /></span>
        <div className="fx-min0 flex-1">
          <h2 id="org-public" className="es-paycard__title">Public profile</h2>
          <p className="text-sm text-muted">Your page on Eventsli, with all your events. Linked from every event page and ticket.</p>
        </div>
        {profile?.slug && (
          <Link href={`/o/${profile.slug}`} className="es-btn es-btn--secondary es-btn--sm" target="_blank">
            View your page <NavIcon name="external" size={14} />
          </Link>
        )}
      </div>

      {state.loading ? (
        <p className="text-sm text-subtle">Loading…</p>
      ) : state.unavailable ? (
        <p className="es-notice es-notice--info">Public profiles are not switched on yet on this server. Your other details still save as usual.</p>
      ) : (
        <form onSubmit={submit} className="fx-stack">
          <div className="es-pubprof__logo">
            <span className="es-orgpage__logo es-orgpage__logo--sm" aria-hidden="true">
              {profile?.logoUrl
                // eslint-disable-next-line @next/next/no-img-element -- your own logo, from our storage
                ? <img src={profile.logoUrl} alt="" />
                : <span>{(profile?.name || '?').slice(0, 1).toUpperCase()}</span>}
            </span>
            <div className="fx-stack fx-stack--sm">
              <p className="es-label">Logo</p>
              <div className="fx-row gap-2">
                <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={() => fileRef.current?.click()} disabled={state.logoBusy}>
                  {state.logoBusy ? 'Uploading…' : profile?.logoUrl ? 'Replace' : 'Upload logo'}
                </button>
                {profile?.logoUrl && (
                  <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={removeLogo} disabled={state.logoBusy}>Remove</button>
                )}
              </div>
              <p className="text-xs text-subtle">Square works best. JPEG, PNG or WebP.</p>
            </div>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={chooseLogo} />
          </div>

          <Field
            label="Page address" name="slug" required minLength={2} maxLength={60}
            hint={`eventsli.com/o/${form.slug || 'your-brand'} — changing it moves your page, and old links stop working.`}
            value={form.slug} onChange={set('slug')} autoComplete="off"
          />

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Contact email" name="publicEmail" type="email" optional maxLength={254}
              hint="Shown publicly. Leave empty to keep it private." value={form.publicEmail} onChange={set('publicEmail')} />
            <Field label="Phone" name="publicPhone" type="tel" optional maxLength={40}
              value={form.publicPhone} onChange={set('publicPhone')} />
          </div>
          <Field label="Website" name="website" optional maxLength={300} placeholder="yourbrand.com"
            value={form.website} onChange={set('website')} />

          <fieldset className="fx-stack fx-stack--sm">
            <legend className="es-label">Social media</legend>
            <div className="grid gap-3 md:grid-cols-2">
              {NETWORKS.map(([key, label, placeholder]) => (
                <Field key={key} label={label} name={`s_${key}`} optional maxLength={300} placeholder={placeholder}
                  value={form[`s_${key}`]} onChange={set(`s_${key}`)} />
              ))}
            </div>
            <p className="text-xs text-subtle">A handle or a full link. Leave a box empty to hide that network.</p>
          </fieldset>

          <p className="text-xs text-subtle">
            Ticket holders can also message you from their ticket. Messages arrive at your account email, and you reply straight to the buyer.
          </p>

          <FormError error={state.error} />
          <div className="fx-row">
            <SubmitButton busy={state.busy} busyLabel="Saving…" disabled={changed.length === 0}>Save public profile</SubmitButton>
            {changed.length > 0 && (
              <button type="button" className="es-btn es-btn--ghost" onClick={() => { setForm(original); setState((s) => ({ ...s, error: null })); }}>
                Discard
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
