// JSON Schema subset used by the mock: validation for request bodies and
// query parameters, plus coercion of the string values that arrive in a URL.
//
// The validator returns every problem with a `$`-rooted path instead of
// throwing on the first one. That is the difference between "400 body.invalid"
// and a message a front-end developer can act on without opening the spec.

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})?$/;
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;

const typeName = (value) => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
};

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function resolveSchema(schema, resolver) {
  if (!schema || typeof schema !== "object" || !schema.$ref || !resolver) return schema;
  return resolver.resolve(schema);
}

function matchesType(value, type) {
  switch (type) {
    case "integer": return Number.isInteger(value);
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "string": return typeof value === "string";
    case "boolean": return typeof value === "boolean";
    case "array": return Array.isArray(value);
    case "object": return value !== null && typeof value === "object" && !Array.isArray(value);
    case "null": return value === null;
    default: return true;
  }
}

/**
 * Validate `value` against a (possibly $ref'd) schema.
 * @returns {{path: string, message: string}[]}
 */
export function validate(value, schema, { resolver, path = "$" } = {}) {
  const errors = [];
  walk(value, schema, path, errors, resolver, 0);
  return errors;
}

function walk(value, schema, path, errors, resolver, depth) {
  if (depth > 32) return;
  const shape = resolveSchema(schema, resolver);
  if (!shape || typeof shape !== "object" || shape.circular) return;

  if (value === null) {
    if (shape.nullable) return;
    if (Array.isArray(shape.type) && shape.type.includes("null")) return;
    if (shape.type && !Array.isArray(shape.type) && shape.type !== "null") {
      errors.push({ path, message: `expected ${shape.type}, received null` });
    }
    return;
  }

  if (Array.isArray(shape.allOf)) {
    for (const branch of shape.allOf) walk(value, branch, path, errors, resolver, depth + 1);
  }
  if (Array.isArray(shape.oneOf)) {
    const matches = shape.oneOf.filter((branch) => validate(value, branch, { resolver, path }).length === 0);
    if (matches.length !== 1) errors.push({ path, message: `must match exactly one oneOf branch (matched ${matches.length})` });
    return;
  }
  if (Array.isArray(shape.anyOf)) {
    if (!shape.anyOf.some((branch) => validate(value, branch, { resolver, path }).length === 0)) {
      errors.push({ path, message: "does not match any anyOf branch" });
    }
    return;
  }
  if (shape.enum && !shape.enum.some((option) => deepEqual(option, value))) {
    errors.push({ path, message: `must be one of ${shape.enum.map((v) => JSON.stringify(v)).join(", ")}` });
    return;
  }
  if (shape.const !== undefined && !deepEqual(shape.const, value)) {
    errors.push({ path, message: `must equal ${JSON.stringify(shape.const)}` });
    return;
  }

  const types = shape.type ? (Array.isArray(shape.type) ? shape.type : [shape.type]) : [];
  if (types.length && !types.some((type) => matchesType(value, type))) {
    errors.push({ path, message: `expected ${types.join(" or ")}, received ${typeName(value)}` });
    return;
  }

  if (typeof value === "string") {
    if (shape.minLength !== undefined && value.length < shape.minLength) {
      errors.push({ path, message: `must be at least ${shape.minLength} characters` });
    }
    if (shape.maxLength !== undefined && value.length > shape.maxLength) {
      errors.push({ path, message: `must be at most ${shape.maxLength} characters` });
    }
    if (shape.pattern) {
      try {
        if (!new RegExp(shape.pattern).test(value)) errors.push({ path, message: `does not match ${shape.pattern}` });
      } catch {
        // A bad pattern in the spec is the spec author's bug, not the caller's.
      }
    }
    const formatChecks = { email: EMAIL, uuid: UUID, date: DATE, "date-time": DATETIME, hostname: HOSTNAME, ipv4: IPV4 };
    const check = formatChecks[shape.format];
    if (check && !check.test(value)) errors.push({ path, message: `must be a valid ${shape.format}` });
    if (shape.format === "uri") {
      try { new URL(value); } catch { errors.push({ path, message: "must be a valid uri" }); }
    }
  }

  if (typeof value === "number") {
    if (shape.minimum !== undefined && value < shape.minimum) errors.push({ path, message: `must be >= ${shape.minimum}` });
    if (shape.maximum !== undefined && value > shape.maximum) errors.push({ path, message: `must be <= ${shape.maximum}` });
    if (shape.exclusiveMinimum !== undefined && value <= shape.exclusiveMinimum) {
      errors.push({ path, message: `must be > ${shape.exclusiveMinimum}` });
    }
    if (shape.exclusiveMaximum !== undefined && value >= shape.exclusiveMaximum) {
      errors.push({ path, message: `must be < ${shape.exclusiveMaximum}` });
    }
    if (shape.multipleOf !== undefined && value % shape.multipleOf !== 0) {
      errors.push({ path, message: `must be a multiple of ${shape.multipleOf}` });
    }
  }

  if (Array.isArray(value)) {
    if (shape.minItems !== undefined && value.length < shape.minItems) {
      errors.push({ path, message: `must contain at least ${shape.minItems} items` });
    }
    if (shape.maxItems !== undefined && value.length > shape.maxItems) {
      errors.push({ path, message: `must contain at most ${shape.maxItems} items` });
    }
    if (shape.items) value.forEach((item, index) => walk(item, shape.items, `${path}[${index}]`, errors, resolver, depth + 1));
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const required of shape.required || []) {
      if (value[required] === undefined) errors.push({ path: `${path}.${required}`, message: "is required" });
    }
    const properties = shape.properties || {};
    for (const [key, child] of Object.entries(properties)) {
      if (value[key] !== undefined) walk(value[key], child, `${path}.${key}`, errors, resolver, depth + 1);
    }
    if (shape.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) errors.push({ path: `${path}.${key}`, message: "is not an allowed property" });
      }
    } else if (shape.additionalProperties && typeof shape.additionalProperties === "object") {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) walk(value[key], shape.additionalProperties, `${path}.${key}`, errors, resolver, depth + 1);
      }
    }
  }
}

/**
 * Coerce a URL/query string into the schema's declared type. Returns
 * `{ ok, value }` or `{ ok: false, message }` — never throws.
 */
export function coerce(value, schema, resolver) {
  const shape = resolveSchema(schema, resolver) || {};
  const types = shape.type ? (Array.isArray(shape.type) ? shape.type : [shape.type]) : [];
  if (value === undefined || value === null) return { ok: true, value };

  if (types.includes("integer") || types.includes("number")) {
    const text = Array.isArray(value) ? value[0] : value;
    const number = typeof text === "number" ? text : Number(text);
    if (!Number.isFinite(number)) return { ok: false, message: `expected ${types[0]}, received "${text}"` };
    if (types.includes("integer") && !Number.isInteger(number)) return { ok: false, message: "expected an integer" };
    return { ok: true, value: number };
  }
  if (types.includes("boolean")) {
    const text = String(Array.isArray(value) ? value[0] : value).toLowerCase();
    if (["true", "1", "yes"].includes(text)) return { ok: true, value: true };
    if (["false", "0", "no"].includes(text)) return { ok: true, value: false };
    return { ok: false, message: `expected a boolean, received "${text}"` };
  }
  if (types.includes("array")) {
    if (Array.isArray(value)) return { ok: true, value };
    return { ok: true, value: String(value).split(",").map((part) => part.trim()) };
  }
  if (types.includes("string")) return { ok: true, value: String(value) };
  return { ok: true, value };
}

/**
 * Validate every declared query parameter, coercing as it goes. Unknown query
 * parameters are reported separately and are allowed: filtering by an
 * undeclared field is a useful thing for a mock to support.
 */
export function validateQuery(query, parameters, resolver) {
  const errors = [];
  const defs = parameters.filter((parameter) => parameter.in === "query");
  const known = new Set(defs.map((parameter) => parameter.name));

  for (const definition of defs) {
    const raw = query[definition.name];
    if (raw === undefined || raw === "") {
      if (definition.required) errors.push({ path: `query.${definition.name}`, message: "is required" });
      continue;
    }
    const result = coerce(raw, definition.schema || definition, resolver);
    if (!result.ok) {
      errors.push({ path: `query.${definition.name}`, message: result.message });
      continue;
    }
    errors.push(...validate(result.value, definition.schema || definition, { resolver, path: `query.${definition.name}` }));
  }

  return { errors, unknown: Object.keys(query).filter((key) => !known.has(key)) };
}
