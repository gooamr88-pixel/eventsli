'use client';

import Field, { SelectField, TextareaField } from '../forms/Field';

/**
 * The details form, built from the admin's settings (2026-11-19): name and
 * email always; phone, event, topic and message as each is set (required,
 * optional or hidden); then the admin's own questions.
 *
 * `website` is a trap for form-filling bots: off-screen, out of the tab
 * order and labelled for people to leave alone. The API discards any
 * booking that fills it.
 */
export default function DemoForm({ settings, values, onChange, onSubmit, busy, error, submitLabel = 'Book my demo' }) {
  const set = (key) => (e) => onChange({ ...values, [key]: e.target.value });
  const setAnswer = (id) => (e) => onChange({ ...values, answers: { ...values.answers, [id]: e.target.value } });
  const f = settings.fields;
  const shown = (key) => f[key].mode !== 'hidden';
  const req = (key) => f[key].mode === 'required';

  return (
    <form className="es-demo-form" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      <Field label="Full name" name="name" autoComplete="name" required maxLength={120} value={values.name} onChange={set('name')} />
      <Field label="Email" name="email" type="email" inputMode="email" autoComplete="email" required maxLength={254}
        value={values.email} onChange={set('email')} hint="Your confirmation and the call details go here." />
      {shown('phone') && (
        <Field label={f.phone.label} name="phone" type="tel" inputMode="tel" autoComplete="tel"
          required={req('phone')} optional={!req('phone')} maxLength={20} pattern="[0-9+\-\(\) ]{7,20}"
          value={values.phone} onChange={set('phone')} />
      )}
      {shown('company') && (
        <Field label={f.company.label} name="company" required={req('company')} optional={!req('company')} maxLength={200}
          value={values.company} onChange={set('company')} />
      )}
      {shown('topic') && settings.topics.length > 0 && (
        <SelectField label={f.topic.label} name="topic" required={req('topic')} optional={!req('topic')}
          value={values.topic} onChange={set('topic')}
          options={[['', 'Please choose'], ...settings.topics.map((t) => [t, t])]} />
      )}
      {settings.questions.map((q) => (q.type === 'select' ? (
        <SelectField key={q.id} label={q.label} required={q.required} optional={!q.required}
          value={values.answers[q.id] || ''} onChange={setAnswer(q.id)}
          options={[['', 'Please choose'], ...q.options.map((o) => [o, o])]} />
      ) : q.type === 'textarea' ? (
        <TextareaField key={q.id} label={q.label} required={q.required} optional={!q.required} rows={3} maxLength={2000}
          value={values.answers[q.id] || ''} onChange={setAnswer(q.id)} />
      ) : (
        <Field key={q.id} label={q.label} required={q.required} optional={!q.required} maxLength={300}
          value={values.answers[q.id] || ''} onChange={setAnswer(q.id)} />
      )))}
      {shown('message') && (
        <TextareaField label={f.message.label} name="message" required={req('message')} optional={!req('message')}
          rows={4} maxLength={2000} value={values.message} onChange={set('message')} />
      )}

      <div className="es-demo-form__trap" aria-hidden="true">
        <label>
          Leave this empty
          <input type="text" name="website" tabIndex={-1} autoComplete="off" value={values.website} onChange={set('website')} />
        </label>
      </div>

      {error && <p role="alert" className="es-demo-form__error">{error}</p>}

      <button type="submit" className="es-btn es-btn--primary es-demo-form__submit" disabled={busy} aria-busy={busy || undefined}>
        {busy ? 'Booking…' : submitLabel}
      </button>
      <p className="es-demo-form__legal">
        We use these details only to arrange and run your demo. See our{' '}
        <a href="/privacy" target="_blank" rel="noopener">privacy policy</a>.
      </p>
    </form>
  );
}
