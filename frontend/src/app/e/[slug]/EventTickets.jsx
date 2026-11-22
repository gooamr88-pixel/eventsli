import NavIcon from '../../components/shell/NavIcon';

/**
 * The organizer's highlights, as icon-led marks.
 *
 * ONE MARK FOR ALL OF THEM, deliberately. The mockup draws a different glyph
 * beside each, but a highlight is free text an organizer typed — there is no
 * field saying which of them means "meet people" and which means "free
 * parking", and guessing an icon from the words would be wrong the first time
 * somebody writes something unexpected. One consistent mark keeps the rhythm
 * the design is after without inventing meaning the data does not carry.
 */
export function EventMarks({ items = [] }) {
  if (items.length === 0) return null;
  return (
    <ul className="es-ev-marks fx-grid" aria-label="Event highlights">
      {items.map((text, i) => (
        <li key={`${text}-${i}`} className="es-ev-mark">
          <span aria-hidden className="es-ev-mark__icon"><NavIcon name="check" size={16} /></span>
          <span className="fx-min0 fx-break">{text}</span>
        </li>
      ))}
    </ul>
  );
}
