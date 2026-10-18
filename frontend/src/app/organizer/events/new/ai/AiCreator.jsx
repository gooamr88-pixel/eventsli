'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { post } from '../../../../utils/apiClient';
import { useAiQuota } from '../../../../hooks/useAiQuota';
import { useCategories } from '../../../../hooks/useCategories';
import { defaultTimeZone } from '../../../../lib/timezones';
import { browserZone } from '../../../../lib/eventTime';
import { DEFAULT_COUNTRY } from '../../../../lib/markets';
import { draftKey } from '../wizardModel';
import { STORAGE_KEY, formFromDraft, problemsFor, savePlan } from './aiDraftModel';
import { saveAiDraft } from './saveAiDraft';
import DescribeStep from './DescribeStep';
import { GeneratingStep, GenerationFailed } from './GeneratingStep';
import DraftReview from './DraftReview';
import EditSheet from './EditSheet';
import { EditBasics, EditAbout, EditWhen } from './EditSections';
import EditTickets from './EditTickets';
import EditSchedule from './EditSchedule';
import SaveStep from './SaveStep';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The Smart Event Creator: Describe → Review → Save.
 *
 * Where the organizer is, and what each button does. The screens are their
 * own files; the rules (what blocks saving, what is sent) are in
 * `aiDraftModel.js`; the save is `saveAiDraft.js`.
 *
 * THE DRAFT SURVIVES A RELOAD, in sessionStorage like the manual wizard's
 * answers — a reload must never be the reason somebody spends their second
 * AI draft of the day. A generation in flight is not kept: reloading mid-wait
 * lands back on the description, which is still there.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const TITLES = { basics: 'Title and category', about: 'About and highlights', when: 'When and where', tickets: 'Tickets', schedule: 'Schedule' };

function loadSaved() {
  try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; }
}

function initialRequest(organizer) {
  const country = organizer?.country || DEFAULT_COUNTRY;
  return { listingType: 'ticketed', country, timezone: defaultTimeZone(country, browserZone()), description: '' };
}

export default function AiCreator({ organizer }) {
  const router = useRouter();
  const { quota, setQuota, refresh } = useAiQuota();
  const categories = useCategories();
  const [saved] = useState(loadSaved);
  const [request, setRequest] = useState(() => saved?.request || initialRequest(organizer));
  const [form, setForm] = useState(() => saved?.form || null);
  const [stage, setStage] = useState(() => (saved?.form && ['review', 'save'].includes(saved.stage) ? saved.stage : 'describe'));
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [partial, setPartial] = useState(null);
  const abort = useRef(null);

  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ request, form, stage: stage === 'generating' || stage === 'failed' ? 'describe' : stage })); } catch { /* private mode */ }
  }, [request, form, stage]);

  // A new screen starts at the top, as the manual wizard's steps do.
  useEffect(() => { try { window.scrollTo({ top: 0 }); } catch { /* old browsers */ } }, [stage]);

  const problems = useMemo(() => (form ? problemsFor(form) : []), [form]);
  const errorFor = (field) => problems.find((p) => p.field === field)?.message || null;
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  async function generate() {
    const controller = new AbortController();
    abort.current = controller;
    setError(null);
    setStage('generating');
    try {
      const data = await post('/ai/event-drafts', { ...request, requestId: crypto.randomUUID() }, { noRedirect: true, signal: controller.signal });
      setForm(formFromDraft(data, organizer));
      setQuota(data.quota);
      setStage('review');
    } catch (err) {
      if (err?.name === 'AbortError') { setStage('describe'); refresh(); return; }
      if (err?.code === 'AI_QUOTA_EXHAUSTED') {
        setQuota((q) => ({ ...(q || {}), remaining: 0, nextAvailableAt: err.meta?.nextAvailableAt || null }));
        setStage('describe');
        return;
      }
      if (err?.code === 'AI_UNAVAILABLE' || err?.code === 'NETWORK') { setStage('failed'); return; }
      setError(err);
      setStage('describe');
    } finally {
      abort.current = null;
    }
  }

  /** Carry the description into the manual wizard, so nothing is retyped. */
  function handOff() {
    try {
      sessionStorage.setItem(draftKey(request.listingType), JSON.stringify({
        form: { description: request.description.trim(), country: request.country, timezone: request.timezone }, step: 0,
      }));
    } catch { /* the manual wizard simply starts empty */ }
    router.push(`/organizer/events/new?type=${request.listingType}`);
  }

  function finish(eventId) {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* fine */ }
    router.push(`/organizer/events/${eventId}?created=1`);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const plan = savePlan(form, organizer.payments?.choices || []);
    try {
      const result = await saveAiDraft(plan);
      if (result.failed.length) setPartial({ ...result, plan });
      else finish(result.eventId);
    } catch (err) {
      setError(err);   // the event itself was not created; nothing to clean up
    } finally {
      setBusy(false);
    }
  }

  async function retryPartial() {
    setBusy(true);
    try {
      const result = await saveAiDraft(partial.plan, { eventId: partial.eventId, only: partial.failed.map((f) => f.key) });
      if (result.failed.length) setPartial({ ...partial, failed: result.failed });
      else finish(partial.eventId);
    } finally {
      setBusy(false);
    }
  }

  if (stage === 'generating') return <GeneratingStep onCancel={() => abort.current?.abort()} />;
  if (stage === 'failed') {
    return <GenerationFailed quota={quota} onRetry={generate} onEdit={() => setStage('describe')} onManual={handOff} />;
  }
  if (stage === 'describe' || !form) {
    return (
      <DescribeStep
        request={request} setRequest={setRequest} quota={quota} error={error}
        onGenerate={generate} onManual={handOff}
        onBackToDraft={form ? () => { setError(null); setStage('review'); } : null}
      />
    );
  }

  if (stage === 'save') {
    const tiers = form.listingType === 'display_only' ? 0 : form.tiers.length;
    const summary = [form.title, tiers && `${tiers} ticket type${tiers === 1 ? '' : 's'}`,
      form.schedule.length && `${form.schedule.length} schedule item${form.schedule.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
    return (
      <SaveStep
        form={form} set={set} organizer={organizer} summary={summary} busy={busy} error={error} partial={partial}
        onBack={() => setStage('review')} onSave={save} onRetryPartial={retryPartial}
      />
    );
  }

  const editor = {
    basics: <EditBasics form={form} set={set} categories={categories.list} errorFor={errorFor} />,
    about: <EditAbout form={form} set={set} />,
    when: <EditWhen form={form} set={set} errorFor={errorFor} />,
    tickets: <EditTickets form={form} set={set} errorFor={errorFor} />,
    schedule: <EditSchedule form={form} set={set} errorFor={errorFor} />,
  }[editing];

  return (
    <>
      <DraftReview
        form={form} problems={problems} quota={quota} categories={categories.list}
        onEdit={setEditing}
        onContinue={() => { if (problems.length === 0) setStage('save'); }}
        onRegenerate={() => setStage('describe')}
      />
      {editor && <EditSheet title={TITLES[editing]} onClose={() => setEditing(null)}>{editor}</EditSheet>}
    </>
  );
}
