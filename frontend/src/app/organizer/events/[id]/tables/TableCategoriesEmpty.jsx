import NavIcon from '../../../../components/shell/NavIcon';
import SplitEmpty from '../../../../components/ui/SplitEmpty';

/**
 * Table categories, before the first one exists.
 *
 * Replaces a dashed "No categories yet." box. The copy says what a category
 * does and stops there: it is a NAME AND A COLOUR on the map. It does not set a
 * price — each table keeps its own (see TableCategories.jsx) — so the empty
 * state must not promise one.
 */
export default function TableCategoriesEmpty({ onAdd }) {
  return (
    <SplitEmpty
      art={<TableArt />}
      title="Add your first table category"
      action={(
        <button type="button" className="es-btn es-btn--primary" onClick={onAdd}>
          <NavIcon name="plus" size={18} />
          Add a category
        </button>
      )}
    >
      Group tables on your seating map and give each group its own name and colour
      (e.g., Front row, Balcony, VIP). Each table keeps its own price.
    </SplitEmpty>
  );
}

/** A dressed round table between two chairs, with three category labels
 *  floating over it. Decorative. Lines and cloth come from the theme's roles;
 *  the label chips keep fixed pastel fills with fixed ink, so they read the
 *  same in both themes. */
function TableArt() {
  const hem = 'q8.5 10 17 0'.repeat(10);
  return (
    <svg className="es-tcat-art" viewBox="0 0 420 290" aria-hidden="true" focusable="false">
      <ellipse className="es-tcat-art__ground" cx="210" cy="258" rx="200" ry="30" />
      <path className="es-tcat-art__line" d="M210 6V24M184 16l9 12M236 16l-9 12" />

      {/* Labels */}
      <g transform="translate(36 72) rotate(-10)">
        <rect width="124" height="34" rx="17" fill="#d9f2e1" />
        <circle cx="19" cy="17" r="5.5" fill="#22a35a" />
        <text x="32" y="22.5" className="es-tcat-art__chip">Front row</text>
      </g>
      <g transform="translate(160 88)">
        <rect width="108" height="34" rx="17" fill="#dcebfd" />
        <circle cx="19" cy="17" r="5.5" fill="#3b82f6" />
        <text x="32" y="22.5" className="es-tcat-art__chip">Balcony</text>
      </g>
      <g transform="translate(296 54) rotate(10)">
        <rect width="86" height="34" rx="17" fill="#ece3fb" />
        <circle cx="19" cy="17" r="5.5" fill="#a78bfa" />
        <text x="34" y="22.5" className="es-tcat-art__chip">VIP</text>
      </g>

      {/* Chairs, behind the table */}
      <g className="es-tcat-art__chair">
        <rect x="90" y="150" width="34" height="74" rx="15" />
        <rect x="100" y="204" width="52" height="11" rx="4" />
        <path d="M100 215 95 256M146 215l4 34" />
      </g>
      <g className="es-tcat-art__chair">
        <rect x="296" y="150" width="34" height="74" rx="15" />
        <rect x="268" y="204" width="52" height="11" rx="4" />
        <path d="M320 215l5 41M274 215l-4 34" />
      </g>

      {/* Table: leg, cloth, top */}
      <path className="es-tcat-art__line" d="M210 236V262M194 264h32" />
      <path className="es-tcat-art__cloth" d={`M125 180V228${hem}V180Z`} />
      <path className="es-tcat-art__fold" d="M152 192V230M181 194V232M210 195V232M239 194V232M268 192V230" />
      <ellipse className="es-tcat-art__cloth" cx="210" cy="180" rx="85" ry="15" />

      {/* Vase and flowers */}
      <path className="es-tcat-art__vase" d="M203 178q-12-10-1-22v-10h16v10q11 12-1 22z" />
      <path className="es-tcat-art__line" d="M210 146v-10M210 140l-8-6M210 140l8-6" />
      <circle className="es-tcat-art__bloom" cx="201" cy="131" r="6" />
      <circle className="es-tcat-art__bloom" cx="219" cy="131" r="6" />
      <circle className="es-tcat-art__bloom" cx="210" cy="124" r="6" />
    </svg>
  );
}
