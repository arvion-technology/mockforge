// Seeded fake data generation from JSON Schema.
//
// The hard requirement for a mock server is reproducibility: the same spec and
// seed must produce the same fixture on every run, so a failing front-end test
// stays failing (or fixed) for the same reason. Every value therefore derives
// its RNG from a hash of the logical path, never from a shared stream, adding
// one field does not shuffle everything after it.

const FIRST = ["Maya", "Nima", "Aarav", "Sita", "Rohan", "Priya", "Kiran", "Anisha", "Bikash", "Lena", "Tenzin", "Meera"];
const LAST = ["Sharma", "Gurung", "Rai", "Thapa", "Karki", "Adhikari", "Sherpa", "Maharjan", "Bhatta", "Lama"];
const NOUNS = ["orbit", "ledger", "signal", "harbor", "canvas", "atlas", "beacon", "summit", "vector", "meadow", "cipher", "pilot"];
const ADJECTIVES = ["quiet", "north", "amber", "steady", "hidden", "bright", "rapid", "gentle", "cobalt", "wireless"];
const CITIES = ["Kathmandu", "Pokhara", "Lalitpur", "Biratnagar", "Chitwan", "Dharan", "Butwal", "Hetauda"];
const COUNTRIES = ["Nepal", "India", "United States", "Germany", "Japan", "Australia", "Singapore", "United Kingdom"];
const COMPANIES = ["Himalayan Supply", "Koshi Labs", "Everest Freight", "Lalitpur Works", "Terai Textiles", "Boudha Studio"];
const DOMAINS = ["example.com", "acme.dev", "northwind.test", "inbox.test"];

/** FNV-1a, used to turn a logical path into a stable 32-bit seed. */
export function hashString(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < String(text).length; i++) {
    hash ^= String(text).charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: tiny, fast, deterministic. */
export function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rng, items) => items[Math.floor(rng() * items.length) % items.length];
const intBetween = (rng, min, max) => min + Math.floor(rng() * (max - min + 1));
const roundTo = (value, step) => Math.round(value / step) * step;

function hex(rng, length) {
  let out = "";
  for (let i = 0; i < length; i++) out += "0123456789abcdef"[Math.floor(rng() * 16)];
  return out;
}

function uuid(rng) {
  const variant = "89ab"[Math.floor(rng() * 4)];
  return `${hex(rng, 8)}-${hex(rng, 4)}-4${hex(rng, 3)}-${variant}${hex(rng, 3)}-${hex(rng, 12)}`;
}

function isoDate(rng, daysBack = 60) {
  const at = Date.now() - intBetween(rng, 0, daysBack) * 86_400_000;
  return new Date(at).toISOString().slice(0, 10);
}

function isoDateTime(rng, daysBack = 30) {
  const at = Date.now() - intBetween(rng, 0, daysBack * 86_400_000);
  return new Date(at).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function sentence(rng, field) {
  const subject = field && field !== "description" ? field.replace(/[_-]/g, " ") : pick(rng, NOUNS);
  return `${pick(rng, ADJECTIVES)} ${subject} for the ${pick(rng, NOUNS)} team`;
}

function sampleString(shape, rng, field) {
  const name = String(field || "").toLowerCase();
  const format = shape.format;

  if (format === "email") return `${pick(rng, FIRST).toLowerCase()}.${pick(rng, LAST).toLowerCase()}@${pick(rng, DOMAINS)}`;
  if (format === "uuid") return uuid(rng);
  if (format === "date") return isoDate(rng);
  if (format === "date-time") return isoDateTime(rng);
  if (format === "uri" || format === "url") return `https://${pick(rng, DOMAINS)}/${pick(rng, NOUNS)}/${intBetween(rng, 10, 999)}`;
  if (format === "hostname") return `${pick(rng, NOUNS)}.${pick(rng, DOMAINS)}`;
  if (format === "ipv4") return `10.${intBetween(rng, 0, 255)}.${intBetween(rng, 0, 255)}.${intBetween(rng, 1, 254)}`;

  if (name === "id" || name.endsWith("_id") || name === "uuid" || name === "key") {
    const prefix = name === "id" ? "" : name.replace(/_id$/, "").slice(0, 3) + "_";
    return `${prefix}${hex(rng, 10)}`;
  }
  if (name === "email") return `${pick(rng, FIRST).toLowerCase()}@${pick(rng, DOMAINS)}`;
  if (name === "name" || name === "full_name" || name === "fullname") return `${pick(rng, FIRST)} ${pick(rng, LAST)}`;
  if (name === "first_name" || name === "firstname") return pick(rng, FIRST);
  if (name === "last_name" || name === "lastname" || name === "surname") return pick(rng, LAST);
  if (name === "company" || name === "organization" || name === "org") return pick(rng, COMPANIES);
  if (name === "city" || name === "town") return pick(rng, CITIES);
  if (name === "country") return pick(rng, COUNTRIES);
  if (name === "title" || name === "subject" || name === "label") return `${pick(rng, ADJECTIVES)} ${pick(rng, NOUNS)}`;
  if (name === "slug" || name === "handle") return `${pick(rng, ADJECTIVES)}-${pick(rng, NOUNS)}-${intBetween(rng, 10, 99)}`;
  if (name === "phone" || name === "phone_number") return `+977-98${intBetween(rng, 10000000, 99999999)}`;
  if (name === "status" || name === "state") return pick(rng, ["active", "pending", "archived"]);
  if (name === "role") return pick(rng, ["owner", "admin", "member", "viewer"]);
  if (name === "currency") return pick(rng, ["USD", "EUR", "NPR"]);
  if (name === "description" || name === "summary" || name === "notes" || name === "bio") return sentence(rng, name);
  if (name === "url" || name === "website" || name === "link") return `https://${pick(rng, DOMAINS)}/${pick(rng, NOUNS)}`;
  if (name === "avatar" || name === "avatar_url" || name === "image") return `https://${pick(rng, DOMAINS)}/avatars/${intBetween(rng, 1, 64)}.png`;
  if (name === "tag" || name === "tags") return pick(rng, NOUNS);

  let value = `${pick(rng, ADJECTIVES)} ${pick(rng, NOUNS)}`;
  if (shape.minLength && value.length < shape.minLength) {
    value = value.padEnd(shape.minLength, "x");
  }
  if (shape.maxLength && value.length > shape.maxLength) value = value.slice(0, shape.maxLength);
  return value;
}

/**
 * Generate one value for a schema.
 *
 * @param {object} schema JSON Schema (may contain local $refs, resolved by resolver)
 * @param {object} options
 * @param {string} options.seed stable seed for this logical location
 * @param {object} options.resolver result of createResolver(spec)
 * @param {string} options.field property name, used to pick realistic values
 * @param {boolean} options.useExample prefer example/default/const from the spec
 */
export function fakeValue(schema, { seed = "seed", resolver, field = "", useExample = false, depth = 0 } = {}) {
  if (!schema || typeof schema !== "object" || depth > 8) return null;
  const shape = schema.$ref && resolver ? resolver.resolve(schema) : schema;
  if (!shape || shape.circular) return null;
  const rng = mulberry32(hashString(`${seed}:${field}`));

  if (useExample && shape.example !== undefined) return structuredClone(shape.example);
  if (shape.default !== undefined) return structuredClone(shape.default);
  if (shape.const !== undefined) return shape.const;
  if (Array.isArray(shape.enum) && shape.enum.length) {
    return Array.isArray(shape.enum[0]) ? shape.enum[0] : pick(rng, shape.enum);
  }
  if (Array.isArray(shape.oneOf) && shape.oneOf.length) return fakeValue(shape.oneOf[0], { seed, resolver, field, useExample, depth: depth + 1 });
  if (Array.isArray(shape.anyOf) && shape.anyOf.length) return fakeValue(shape.anyOf[0], { seed, resolver, field, useExample, depth: depth + 1 });
  if (Array.isArray(shape.allOf) && shape.allOf.length) {
    const merged = shape.allOf.reduce((acc, branch) => {
      const resolved = branch.$ref && resolver ? resolver.resolve(branch) : branch;
      return { ...acc, ...resolved, properties: { ...(acc.properties || {}), ...(resolved.properties || {}) } };
    }, {});
    return fakeValue({ ...merged, type: "object" }, { seed, resolver, field, useExample, depth: depth + 1 });
  }

  let types = shape.type ? (Array.isArray(shape.type) ? shape.type : [shape.type]) : [];
  if (!types.length) types = shape.properties ? ["object"] : shape.items ? ["array"] : ["string"];
  if (shape.nullable && rng() < 0.08) return null;

  const type = types.includes("null") ? types.find((entry) => entry !== "null") || "string" : types[0];

  if (type === "object") {
    const output = {};
    const properties = shape.properties || {};
    const required = new Set(shape.required || []);
    for (const [key, property] of Object.entries(properties)) {
      if (!required.has(key) && rng() < 0.25) continue;
      output[key] = fakeValue(property, {
        seed: `${seed}/${key}`,
        resolver,
        field: key,
        useExample,
        depth: depth + 1,
      });
    }
    return output;
  }

  if (type === "array") {
    const min = shape.minItems ?? (field === "tags" ? 2 : 1);
    const max = shape.maxItems ?? Math.max(min, 3);
    const count = intBetween(rng, min, Math.max(min, Math.min(max, 4)));
    return Array.from({ length: count }, (_, index) =>
      fakeValue(shape.items || { type: "string" }, {
        seed: `${seed}#${index}`,
        resolver,
        field,
        useExample,
        depth: depth + 1,
      }));
  }

  if (type === "integer" || type === "number") {
    const low = shape.minimum ?? (/(price|amount|cost|total|budget|salary)/.test(field) ? 25 : 0);
    const high = shape.maximum ?? (/(price|amount|cost|total|budget|salary)/.test(field) ? 900 : 1000);
    if (type === "integer") {
      const value = intBetween(rng, Math.ceil(low), Math.floor(high));
      return shape.multipleOf ? roundTo(value, shape.multipleOf) : value;
    }
    const value = low + rng() * (high - low);
    const rounded = shape.multipleOf ? roundTo(value, shape.multipleOf) : Math.round(value * 100) / 100;
    return Math.min(high, Math.max(low, rounded));
  }

  if (type === "boolean") return rng() > 0.42;
  if (type === "null") return null;

  const text = sampleString(shape, rng, field);
  if (shape.minLength && text.length < shape.minLength) return text.padEnd(shape.minLength, "x");
  if (shape.maxLength && text.length > shape.maxLength) return text.slice(0, shape.maxLength);
  return text;
}

/** A list of generated objects, seeded per index so item N never depends on N-1. */
export function fakeList(schema, { count = 10, seed = "fixtures", resolver, useExample = false } = {}) {
  return Array.from({ length: count }, (_, index) =>
    fakeValue(schema, { seed: `${seed}#${index}`, resolver, useExample }));
}
