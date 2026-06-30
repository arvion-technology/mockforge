// Route compilation and response shaping.
//
// OpenAPI path templates are compiled once into anchored regular expressions.
// A request then does one pass over the compiled routes, which keeps the
// request path allocation-free apart from the URL match itself.
import { listOperations } from "./spec.js";
import { fakeList, fakeValue } from "./fake.js";
import { validate } from "./schema.js";

const escapeSegment = (segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function jsonSchemaFrom(response) {
  if (!response || typeof response !== "object") return null;
  const content = response.content;
  if (!content || typeof content !== "object") return null;
  const media = content["application/json"] || Object.values(content)[0];
  return media?.schema || null;
}

function successResponse(operation) {
  const responses = operation.responses || {};
  for (const code of ["200", "201", "204", "2XX", "default"]) {
    if (responses[code]) return responses[code];
  }
  const key = Object.keys(responses).find((code) => /^2\d\d$/.test(code));
  return key ? responses[key] : null;
}

function resourceOf(path) {
  const withoutParameters = path.replace(/\{[^}]+\}/g, "").replace(/\/+$/, "");
  const segments = withoutParameters.split("/").filter(Boolean);
  return segments.length ? segments[segments.length - 1] : null;
}

/** Request body JSON Schema, if the operation declares one. */
export function requestSchema(operation, resolver) {
  const content = operation.requestBody?.content;
  if (!content) return null;
  const media = content["application/json"] || Object.values(content)[0];
  return media?.schema ? resolver.resolve(media.schema) : null;
}

/**
 * Compile every operation into a route with a regex and the schemas needed to
 * seed and shape responses.
 */
export function compileRoutes(spec, resolver) {
  const routes = listOperations(spec).map((operation) => {
    const keys = [];
    const source = operation.path.replace(/\/+$/, "") || "/";
    const pattern = source
      .split("/")
      .map((segment) => {
        const parameter = segment.match(/^\{([^}]+)\}$/);
        if (parameter) {
          keys.push(parameter[1]);
          return "([^/]+)";
        }
        return escapeSegment(segment);
      })
      .join("/");

    return {
      ...operation,
      keys,
      regex: new RegExp(`^${pattern}/?$`),
      resource: resourceOf(operation.path),
      listSchema: null,
      itemSchema: null,
      sample: null,
    };
  });

  // Two passes: first collect schemas per resource, then attach them to every
  // route that shares the resource so POST/DELETE know the item shape too.
  const byResource = new Map();
  for (const route of routes) {
    const resolved = jsonSchemaFrom(successResponse(route.operation));
    if (!resolved) continue;
    const schema = resolver.resolve(resolved);
    const bucket = byResource.get(route.resource) || {};
    if (schema?.type === "array" || schema?.items) {
      bucket.list = schema;
      bucket.item = bucket.item || schema.items || null;
    } else if (schema?.properties?.items) {
      // Wrapped list: { items: [...], total: n }
      bucket.list = schema;
      bucket.item = bucket.item || schema.properties.items.items || schema.properties.items;
    } else if (schema?.type === "object" || schema?.properties) {
      bucket.item = bucket.item || schema;
    }
    byResource.set(route.resource, bucket);
  }

  for (const route of routes) {
    const bucket = byResource.get(route.resource) || {};
    if (route.keys.length) {
      const resolved = jsonSchemaFrom(successResponse(route.operation));
      route.itemSchema = resolved ? resolver.resolve(resolved) : bucket.item || null;
      route.listSchema = bucket.list || null;
    } else {
      const resolved = jsonSchemaFrom(successResponse(route.operation));
      route.listSchema = resolved ? resolver.resolve(resolved) : bucket.list || null;
      route.itemSchema = bucket.item || requestSchema(route.operation, resolver);
    }
    // Write operations should prefill their request body, not a response item.
    const sampleSchema = route.method === "POST" || route.method === "PATCH" || route.method === "PUT"
      ? requestSchema(route.operation, resolver) || route.itemSchema
      : route.itemSchema;
    if (sampleSchema) {
      route.sample = fakeValue(sampleSchema, { seed: `sample:${route.method}:${route.path}`, resolver, useExample: true });
    }
  }

  return routes;
}

/** Strict matching: wrong method on a known path is a 405, not a 404. */
export function matchRoute(routes, method, pathname) {
  const candidates = routes.filter((route) => route.regex.test(pathname));
  if (!candidates.length) return { error: 404 };
  // HEAD is allowed anywhere GET is, without declaring it in the spec.
  const route = candidates.find((candidate) => candidate.method === method)
    || (method === "HEAD" ? candidates.find((candidate) => candidate.method === "GET") : undefined);
  if (!route) return { error: 405, allowed: [...new Set(candidates.map((candidate) => candidate.method))] };
  const values = pathname.match(route.regex).slice(1).map((value) => decodeURIComponent(value));
  const params = Object.fromEntries(route.keys.map((key, index) => [key, values[index]]));
  return { route, params };
}

const FILTER_KEYS = new Set(["limit", "offset", "sort", "q", "page"]);

/** Filter collection results using undeclared query keys as equality filters. */
export function filterItems(items, query = {}) {
  let out = items;
  if (query.q) {
    const needle = String(query.q).toLowerCase();
    out = out.filter((item) => JSON.stringify(item).toLowerCase().includes(needle));
  }
  for (const [key, raw] of Object.entries(query)) {
    if (FILTER_KEYS.has(key)) continue;
    if (raw === undefined || raw === "") continue;
    const value = String(raw);
    out = out.filter((item) => item[key] !== undefined && String(item[key]) === value);
  }
  return out;
}

export function sortItems(items, sort) {
  if (!sort) return items;
  const descending = sort.startsWith("-");
  const field = (descending ? sort.slice(1) : sort).trim();
  if (!field) return items;
  return [...items].sort((a, b) => {
    const left = a[field];
    const right = b[field];
    if (left === right) return 0;
    const result = left === undefined ? 1 : right === undefined ? -1 : left < right ? -1 : 1;
    return descending ? -result : result;
  });
}

/** Shape a collection response from its declared schema. */
export function shapeList(route, items, query = {}) {
  const filtered = sortItems(filterItems(items, query), query.sort);
  const schema = route.listSchema || route.itemSchema;
  const limit = Number(query.limit);
  const offset = Math.max(0, Number(query.offset) || 0);
  const size = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : filtered.length;
  const page = filtered.slice(offset, offset + size);

  if (schema && (schema.type === "array" || schema.items)) return page;
  // Wrapped list: fill the declared envelope keys, then the usual pagination.
  const envelope = { items: page, total: filtered.length };
  if (schema?.properties?.limit) envelope.limit = size;
  if (schema?.properties?.offset) envelope.offset = offset;
  return envelope;
}

/** Seed a resource with deterministic fixtures built from its item schema. */
export function seedItems(route, resolver, { count = 12, seed = 7 } = {}) {
  const schema = route.itemSchema || requestSchema(route.operation, resolver);
  if (!schema) return [{ id: `${route.resource || "itm"}_001`, name: `${route.resource || "item"} fixture` }];
  return fakeList(schema, { count, seed: `${seed}:${route.resource}`, resolver });
}

/** Compact route description used by the CLI `list` command and the demo. */
export function describeRoute(route, resolver) {
  const query = route.parameters
    .filter((parameter) => parameter.in === "query")
    .map((parameter) => ({ name: parameter.name, required: Boolean(parameter.required), type: parameter.schema?.type || "string" }));
  const bodySchema = route.requestBody ? requestSchema(route.operation, resolver) : null;
  return {
    method: route.method,
    path: route.path,
    summary: route.summary,
    operationId: route.operationId,
    resource: route.resource,
    pathParams: route.keys,
    query,
    hasBody: Boolean(route.requestBody),
    bodyFields: bodySchema?.properties ? Object.keys(bodySchema.properties) : [],
    status: successResponse(route.operation) ? Object.keys(route.operation.responses || {})[0] : null,
  };
}

export const routeValidators = { validate };
