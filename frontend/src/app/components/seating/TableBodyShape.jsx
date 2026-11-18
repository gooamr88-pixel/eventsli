'use client';

/**
 * A table's body from `seatingGeometry.tableBody`, drawn — every kind it can
 * return, in one place, so the editor, the buyer's map, the printed pack and
 * the Add dialog cannot disagree about what a D-shape looks like.
 *
 * `pad` grows the outline outward (a selection halo). Everything else is
 * passed straight to the SVG element: fill, stroke, handlers, a <title> child.
 */
export default function TableBodyShape({ body, pad = 0, children, ...props }) {
  if (!body || body.kind === 'none') return null;
  if (body.kind === 'ellipse') {
    return <ellipse rx={body.width / 2 + pad} ry={body.height / 2 + pad} {...props}>{children}</ellipse>;
  }
  if (body.kind === 'path') {
    const sx = pad ? (body.width + pad * 2) / body.width : 1;
    const sy = pad ? (body.height + pad * 2) / body.height : 1;
    return (
      <path d={body.d} transform={pad ? `scale(${sx} ${sy})` : undefined} {...props}>{children}</path>
    );
  }
  return (
    <rect
      x={-body.width / 2 - pad} y={-body.height / 2 - pad}
      width={body.width + pad * 2} height={body.height + pad * 2}
      rx={(body.rx || 0) + (pad ? pad : 0)}
      {...props}
    >
      {children}
    </rect>
  );
}
