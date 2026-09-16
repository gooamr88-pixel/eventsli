'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { PageHeader } from '../../components/ui/Page';
import { Loading, ErrorNotice, Notice } from '../../components/Feedback';
import BlockForm from './BlockForm';
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
  const { data, error, loading, reload } = useApi('/admin/storefront/content');
  const [saved, setSaved] = useState({});

  if (loading) return <Loading label="Loading the homepage’s content…" />;
  if (error) return <ErrorNotice error={error} onRetry={reload} />;

  const blocks = data?.blocks || [];
  const content = { ...(data?.content || {}), ...saved };

  if (!canEdit) {
    return (
      <div className="fx-stack">
        {blocks.map((block) => (
          <ReadOnlyBlock key={block.key} block={block} values={content[block.key] || {}} />
        ))}
      </div>
    );
  }

  return (
    <div className="fx-stack">
      {blocks.map((block) => (
        <BlockForm
          key={block.key}
          block={block}
          values={content[block.key] || {}}
          // Held locally rather than reloading every block: a save answers with
          // the normalised value, and re-fetching all six to apply one of them
          // discards the other five forms' unsaved edits.
          onSaved={(key, value) => setSaved((s) => ({ ...s, [key]: value }))}
        />
      ))}
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
