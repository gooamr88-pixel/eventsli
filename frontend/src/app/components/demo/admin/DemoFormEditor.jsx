'use client';

import NavIcon from '../../shell/NavIcon';
import { TextListEditor } from './DemoHoursEditor';

const FIELDS = [
  ['phone', 'Phone'],
  ['company', 'Event name or website'],
  ['topic', '"How can we help?" list'],
  ['message', 'Message box'],
];
const MODES = [['required', 'Required'], ['optional', 'Optional'], ['hidden', 'Hidden']];

/**
 * The booking form, as the admin shapes it: name and email are always asked;
 * the four built-in fields can each be required, optional or hidden, with
 * their own wording; then up to ten questions of the admin's own.
 */
export default function DemoFormEditor({ settings, onChange }) {
  const setField = (key, patch) => onChange({ ...settings, fields: { ...settings.fields, [key]: { ...settings.fields[key], ...patch } } });
  const questions = settings.questions;
  const setQuestions = (next) => onChange({ ...settings, questions: next });
  const setQ = (i, patch) => setQuestions(questions.map((q, j) => (j === i ? { ...q, ...patch } : q)));

  return (
    <div className="fx-stack">
      <p className="es-demo-admin__small">Full name and email are always asked.</p>
      <div className="es-demo-fields">
        {FIELDS.map(([key, name]) => (
          <div key={key} className="es-demo-fields__row">
            <span className="es-demo-fields__name">{name}</span>
            <select className="es-input" aria-label={`${name}: required, optional or hidden`} value={settings.fields[key].mode}
              onChange={(e) => setField(key, { mode: e.target.value })}>
              {MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input className="es-input" aria-label={`${name}: the question people see`} maxLength={120}
              value={settings.fields[key].label} onChange={(e) => setField(key, { label: e.target.value })}
              disabled={settings.fields[key].mode === 'hidden'} />
          </div>
        ))}
      </div>

      <div>
        <p className="es-demo-admin__label">Choices in the &ldquo;How can we help?&rdquo; list</p>
        <TextListEditor value={settings.topics} onChange={(topics) => onChange({ ...settings, topics })}
          placeholder="e.g. Seating maps and tables" addLabel="Add choice" />
      </div>

      <div className="fx-stack fx-stack--sm">
        <p className="es-demo-admin__label">Your own questions <span>({questions.length}/10)</span></p>
        {questions.map((q, i) => (
          <div key={q.id || i} className="es-demo-question">
            <input className="es-input" aria-label="Question" placeholder="e.g. How many guests do you expect?" maxLength={160}
              value={q.label} onChange={(e) => setQ(i, { label: e.target.value })} />
            <select className="es-input" aria-label="Answer type" value={q.type} onChange={(e) => setQ(i, { type: e.target.value })}>
              <option value="text">Short answer</option>
              <option value="textarea">Long answer</option>
              <option value="select">Pick from a list</option>
            </select>
            <label className="es-demo-admin__check">
              <input type="checkbox" checked={q.required} onChange={(e) => setQ(i, { required: e.target.checked })} /> Required
            </label>
            <button type="button" className="es-btn es-btn--ghost es-btn--sm" aria-label="Remove this question"
              onClick={() => setQuestions(questions.filter((_, j) => j !== i))}>
              <NavIcon name="trash" size={16} />
            </button>
            {q.type === 'select' && (
              <div className="es-demo-question__options">
                <TextListEditor value={q.options || []} onChange={(options) => setQ(i, { options })}
                  placeholder="An answer to pick" addLabel="Add answer" max={20} />
                {(q.options || []).length === 0 && <p className="es-demo-admin__small">Add at least one answer, or the question is not saved.</p>}
              </div>
            )}
          </div>
        ))}
        {questions.length < 10 && (
          <button type="button" className="es-btn es-btn--secondary es-btn--sm es-demo-hours__add"
            onClick={() => setQuestions([...questions, { id: `q${Date.now().toString(36)}`, label: '', type: 'text', options: [], required: false }])}>
            <NavIcon name="plus" size={16} /> Add a question
          </button>
        )}
      </div>
    </div>
  );
}
