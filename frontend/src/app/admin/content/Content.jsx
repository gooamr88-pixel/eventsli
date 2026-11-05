'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { PageHeader } from '../../components/ui/Page';
import { Loading, ErrorNotice, Notice } from '../../components/Feedback';
import { put } from '../../utils/apiClient';
import { messageFor } from '../../utils/errors';
import { useToast } from '../../components/ui/Toast';
import NavIcon from '../../components/shell/NavIcon';
import BlockForm, { isDirty, PATH_FIELD } from './BlockForm';
import ListEditor from './ListEditor';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The homepage, editable.
 *
 * Five tabs over three kinds of thing: the blocks of copy (`site_content`), the
 * three ordered lists, and nothing else. There is deliberately no control here
 * for the ORDER OF THE BANDS or for adding one — a CMS that lets an operator
 * rearrange the page is a CMS that lets an operator break the band rhythm the
 * design system exists to protect, and `scripts/contrast.js` cannot check a
 * layout assembled at runtime.
 *
 * SUPER-ADMIN ONLY for writes, matching /admin/settings: everything on this
 * page appears on the front of the site to everybody, signed in or not. A plain
 * admin sees the screen and is told why it is read-only, rather than being given
 * inputs whose Save can only return 403.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const TABS = [
  { key: 'blocks', label: 'Page content' },
  { key: 'categories', label: 'Categories' },
  { key: 'sponsors', label: 'Sponsors' },
  { key: 'testimonials', label: 'Testimonials' },
];

export default function Content() {
  const { user } = useAuth();
  const canEdit = Boolean(user?.isSuperAdmin);
  const [tab, setTab] = useState('blocks');

  return (
    <div className="fx-stack">
      <PageHeader
        eyebrow="Storefront"
        title="Homepage content"
        lede="What the public homepage says and shows. Changes appear immediately — the page's cache is dropped on every save."
        actions={(
          <Link href="/" className="es-btn es-btn--secondary es-btn--sm" target="_blank" rel="noopener">
            <NavIcon name="external" size={16} />
            View the homepage
          </Link>
        )}
      />

      {!canEdit && (
        <Notice tone="info">
          Only a super admin can change what the homepage says. You can read everything here.
        </Notice>
      )}

      {/* `role="tablist"` is not used, and that is deliberate: real ARIA tabs
          owe the reader arrow-key navigation and focus management, and these
          are buttons that swap a panel. Announcing them as something they do
          not behave like is worse than announcing them as buttons. */}
      <nav aria-label="Content sections" className="fx-row fx-row--scroll fx-row--scroll-sm">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setTab(entry.key)}
            aria-current={tab === entry.key ? 'page' : undefined}
            className="es-tab"
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {tab === 'blocks' ? <Blocks canEdit={canEdit} /> : <ListEditor kind={tab} />}
    </div>
  );
}

/**
 * The `site_content` blocks.
 *
 * The field list comes from the API, which reads `backend/utils/landingSchema.js`
 * — so a field added to the schema appears here without this file changing. See
 * BlockForm for why that is worth the indirection.
 */
function Blocks({ canEdit }) {
  const toast = useToast();
  const { data, error, loading, reload } = useApi('/admin/storefront/content');
  // `saved`: values the API answered with since load. `drafts`: only the
  // blocks somebody has touched. `errors`: per block, from the last save.
  const [saved, setSaved] = useState({});
  const [drafts, setDrafts] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  if (loading) return <Loading label="Loading the homepage’s content…" />;
  if (error) return <ErrorNotice error={error} onRetry={reload} />;

  const blocks = data?.blocks || [];
  const content = { ...(data?.content || {}), ...saved };
  const valuesOf = (key) => content[key] || {};
  const draftOf = (key) => drafts[key] || valuesOf(key);
  const changed = blocks.filter((b) => drafts[b.key] && isDirty(b, drafts[b.key], valuesOf(b.key)));

  const edit = (key, patch) => setDrafts((d) => ({ ...d, [key]: { ...(d[key] || valuesOf(key)), ...patch } }));
  /** An image is two values and they must move together — the API refuses a
   *  URL with no object key and the reverse. */
  const editImage = (key, name, result) => edit(key, {
    [name]: result?.url || '',
    ...(PATH_FIELD[name] ? { [PATH_FIELD[name]]: result?.path || '' } : {}),
  });

  /**
   * One PUT per changed block, in order, each kept or reported on its own: a
   * refusal on the hero does not throw away a good edit to the stats. A block
   * that saved leaves `drafts`; one that failed stays, with its message on it.
   */
  async function saveAll() {
    setSaving(true);
    const failed = {};
    let done = 0;
    for (const block of changed) {
      try {
        const result = await put(`/admin/storefront/content/${block.key}`, drafts[block.key]);
        setSaved((s) => ({ ...s, [block.key]: result.value }));
        setDrafts((d) => { const next = { ...d }; delete next[block.key]; return next; });
        done += 1;
      } catch (err) {
        // The API returns every complaint at once in `meta.errors`, so the
        // operator fixes one form rather than finding a second problem after
        // fixing the first.
        failed[block.key] = err?.meta?.errors?.join(' ') || messageFor(err);
      }
    }
    setErrors(failed);
    setSaving(false);
    const bad = Object.keys(failed).length;
    if (bad) toast.error(`${bad} ${bad === 1 ? 'section was' : 'sections were'} not saved — see the message on ${bad === 1 ? 'it' : 'each'}.`);
    else if (done) toast.show('Saved. The homepage is already showing it.');
  }

  function discardAll() {
    setDrafts({});
    setErrors({});
  }

  if (!canEdit) {
    return (
      <div className="fx-stack">
        {blocks.map((block) => (
          <ReadOnlyBlock key={block.key} block={block} values={content[block.key] || {}} />
        ))}
      </div>
    );
  }

  const pending = changed.length;

  return (
    <div className="fx-stack">
      {blocks.map((block) => (
        <BlockForm
          key={block.key}
          block={block}
          draft={draftOf(block.key)}
          dirty={changed.includes(block)}
          error={errors[block.key]}
          onField={(name, value) => edit(block.key, { [name]: value })}
          onImage={(name, result) => editImage(block.key, name, result)}
        />
      ))}

      {/* One bar for the whole page, there only while something is unsaved.
          `.es-savebar` is the event editor's own sticky bar. Saved values are
          held locally rather than re-fetched: a save answers with the
          normalised value, and reloading every block to apply one of them
          would discard the others' unsaved edits. */}
      {(pending > 0 || saving) && (
        <div className="es-savebar es-savebar--page">
          <p className="es-savebar__status" aria-live="polite">
            <span className="es-savebar__dot" aria-hidden="true" />
            <b className="text-ink">Unsaved changes</b>
            {' '}
            {pending === 1 ? 'in one section' : `in ${pending} sections`}
          </p>
          <span className="fx-row">
            <button type="button" className="es-btn es-btn--secondary" disabled={saving} onClick={discardAll}>Discard</button>
            <button type="button" className="es-btn es-btn--primary" disabled={saving} onClick={saveAll}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </span>
        </div>
      )}
    </div>
  );
}

function ReadOnlyBlock({ block, values }) {
  return (
    <section className="es-card es-panel">
      <div className="es-panel-head">
        <h2 className="es-panel-head__title">{block.label}</h2>
      </div>
      <dl className="fx-grid fx-grid--2">
        {block.fields.map((field) => (
          <div key={field.name} className="fx-stack fx-stack--sm gap-1">
            <dt className="text-xs uppercase tracking-[0.08em] text-subtle">{field.label}</dt>
            <dd className="fx-break text-sm text-ink">
              {formatValue(values[field.name])}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function formatValue(value) {
  if (value === true) return 'On';
  if (value === false) return 'Off';
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}
