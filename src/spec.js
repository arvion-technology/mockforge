// OpenAPI document loading, local $ref resolution and operation listing.
//
// Resolution is deliberately local-only: a mock server that reaches the
// network to fetch a remote $ref is a mock server that fails on a plane. Any
// ref that is not `#/...` is rejected with a message that says so.
import { parseYaml } from "./yaml.js";

const METHODS = ["get", "put", "post", "delete", "patch", "head", "options"];

/**
 * Parse a spec from YAML or JSON text and check the parts the mock server needs.
 * @param {string} text
 * @returns {object}
 */
export function parseSpec(text) {
  if (typeof text !== "string") throw new TypeError("parseSpec expects a string");
  const source = text.trim();
  if (!source) throw new Error("spec is empty");

  let document;
  if (source.startsWith("{") || source.startsWith("[")) {
    try {
      document = JSON.parse(source);
    } catch (error) {
      throw new Error(`invalid JSON spec: ${error.message}`);
    }
  } else {
    document = parseYaml(text);
  }

  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error("spec did not parse to an object");
  }
  if (!document.openapi && !document.swagger) {
    throw new Error("not an OpenAPI document: missing an 'openapi' version field");
  }
  if (!document.paths || typeof document.paths !== "object") {
    throw new Error("OpenAPI document has no 'paths' object");
  }
  return document;
}

/** The one-line summary the demo and CLI show above the editor. */
export function specInfo(spec) {
  return {
    title: spec.info?.title || "Untitled API",
    version: spec.info?.version || "",
    openapi: spec.openapi || spec.swagger || "",
    description: spec.info?.description || "",
    servers: Array.isArray(spec.servers) ? spec.servers.map((s) => s.url).filter(Boolean) : [],
    pathCount: Object.keys(spec.paths || {}).length,
  };
}

/**
 * Resolve a JSON Pointer (`#/components/schemas/Task`) inside a document.
 * Returns undefined when the pointer is well-formed but points at nothing.
 */
export function resolvePointer(root, pointer) {
  if (typeof pointer !== "string" || !pointer.startsWith("#")) {
    throw new Error(`only local $refs are supported, received "${pointer}"`);
  }
  if (pointer === "#") return root;
  const parts = pointer
    .slice(1)
    .split("/")
    .filter(Boolean)
    .map((part) => decodeURIComponent(part).replace(/~1/g, "/").replace(/~0/g, "~"));

  let node = root;
  for (const part of parts) {
    if (node === null || typeof node !== "object") return undefined;
    if (!(part in node)) return undefined;
    node = node[part];
  }
  return node;
}

/**
 * Build a resolver that inlines every local `$ref`.
 *
 * Circular schemas are real (a comment with replies) so rather than throw we
 * leave a `{ $ref, circular: true }` marker at the point the cycle closes.
 * Validators and the fake generator treat that marker as "unknown", and the
 * recorded request shows it, silently expanding forever would not.
 */
export function createResolver(root) {
  const cache = new Map();

  function resolve(node, stack = []) {
    if (Array.isArray(node)) return node.map((item) => resolve(item, stack));
    if (node === null || typeof node !== "object") return node;

    if (typeof node.$ref === "string") {
      const ref = node.$ref;
      const siblings = Object.fromEntries(
        Object.entries(node)
          .filter(([key]) => key !== "$ref")
          .map(([key, value]) => [key, resolve(value, stack)]),
      );
      if (stack.includes(ref)) return { $ref: ref, circular: true, ...siblings };

      if (!cache.has(ref)) {
        const target = resolvePointer(root, ref);
        if (target === undefined) throw new Error(`unresolved $ref "${ref}"`);
        cache.set(ref, resolve(target, [...stack, ref]));
      }
      const resolved = cache.get(ref);
      return Object.keys(siblings).length ? { ...resolved, ...siblings } : resolved;
    }

    const out = {};
    for (const [key, value] of Object.entries(node)) out[key] = resolve(value, stack);
    return out;
  }

  return {
    root,
    /** Resolve one node (safe to call repeatedly; ref targets are cached). */
    resolve: (node) => resolve(node),
    /** Resolve a pointer directly. */
    pointer: (ref) => resolvePointer(root, ref),
  };
}

/**
 * Flatten the document into one object per operation. Path-level `parameters`
 * are merged into each operation, matching the OpenAPI inheritance rule.
 */
export function listOperations(spec) {
  const resolver = createResolver(spec);
  const operations = [];

  for (const [path, pathItem] of Object.entries(spec.paths || {})) {
    if (!pathItem || typeof pathItem !== "object") continue;
    if (pathItem.$ref) throw new Error(`path-level $ref is not supported (${path})`);
    const shared = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];

    for (const method of METHODS) {
      const operation = pathItem[method];
      if (!operation || typeof operation !== "object") continue;
      const parameters = [...shared, ...(Array.isArray(operation.parameters) ? operation.parameters : [])]
        .map((parameter) => resolver.resolve(parameter))
        .filter(Boolean);

      operations.push({
        method: method.toUpperCase(),
        path,
        operationId: operation.operationId || `${method}_${path.replace(/[{}]/g, "")}`,
        summary: operation.summary || operation.description || "",
        tags: Array.isArray(operation.tags) ? operation.tags : [],
        parameters,
        requestBody: operation.requestBody ? resolver.resolve(operation.requestBody) : null,
        responses: operation.responses ? resolver.resolve(operation.responses) : {},
        deprecated: operation.deprecated === true,
        operation,
      });
    }
  }
  return operations;
}

/** First server URL path (`https://api.example.com/v1` -> `/v1`), for display. */
export function serverBasePath(spec) {
  const url = spec.servers?.[0]?.url;
  if (!url) return "";
  try {
    const parsed = new URL(url, "http://placeholder");
    return parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
  } catch {
    return "";
  }
}
