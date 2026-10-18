/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE description of the answer, rendered for each provider.
 *
 * The two providers ask for the same shape in two dialects, and a schema
 * written twice is a schema that drifts — the classic result being a field one
 * model can return and the other cannot, which only shows up on the day the
 * fallback is used. So the shape is written once with the builders below and
 * emitted as:
 *
 *   toStrictJsonSchema   Groq `response_format: json_schema, strict: true`.
 *                        Every object closed (`additionalProperties: false`),
 *                        every property required, "optional" spelled as a
 *                        `["string", "null"]` type union — strict mode accepts
 *                        nothing else.
 *   toGeminiSchema       Gemini `generationConfig.responseSchema`, the OpenAPI
 *                        subset: upper-case types, `nullable: true`, and
 *                        `propertyOrdering` so the model writes the fields in
 *                        the order the prompt explains them.
 *
 * Lengths are NOT in the schema. Neither dialect enforces them reliably, and
 * the server validator (`eventDraftValidate.js`) is what actually bounds every
 * field to the column it ends up in. The schema's job is shape, not policy.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const s = {
  string: (o = {}) => ({ t: 'string', ...o }),
  integer: (o = {}) => ({ t: 'integer', ...o }),
  number: (o = {}) => ({ t: 'number', ...o }),
  boolean: (o = {}) => ({ t: 'boolean', ...o }),
  array: (items, o = {}) => ({ t: 'array', items, ...o }),
  object: (props, o = {}) => ({ t: 'object', props, ...o }),
  nullable: (node) => ({ ...node, nullable: true }),
};

function toStrictJsonSchema(node) {
  const base = {};
  if (node.description) base.description = node.description;
  const type = node.nullable ? [node.t, 'null'] : node.t;

  if (node.t === 'object') {
    const properties = {};
    for (const [k, v] of Object.entries(node.props)) properties[k] = toStrictJsonSchema(v);
    return { ...base, type, properties, required: Object.keys(node.props), additionalProperties: false };
  }
  if (node.t === 'array') {
    return {
      ...base, type, items: toStrictJsonSchema(node.items),
      ...(node.maxItems ? { maxItems: node.maxItems } : {}),
    };
  }
  if (node.enum) {
    // A nullable enum has to list null among its values, or a strict
    // validator rejects the very null the type union allows.
    return { ...base, type, enum: node.nullable ? [...node.enum, null] : node.enum };
  }
  return { ...base, type };
}

function toGeminiSchema(node) {
  const out = { type: node.t.toUpperCase() };
  if (node.description) out.description = node.description;
  if (node.nullable) out.nullable = true;

  if (node.t === 'object') {
    out.properties = {};
    for (const [k, v] of Object.entries(node.props)) out.properties[k] = toGeminiSchema(v);
    out.required = Object.keys(node.props);
    out.propertyOrdering = Object.keys(node.props);
  } else if (node.t === 'array') {
    out.items = toGeminiSchema(node.items);
    if (node.maxItems) out.maxItems = node.maxItems;
  } else if (node.enum) {
    out.enum = node.enum;
  }
  return out;
}

module.exports = { s, toStrictJsonSchema, toGeminiSchema };
