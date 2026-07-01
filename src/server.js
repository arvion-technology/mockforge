// The mock server core.
//
// `createMockForge` is a pure request handler: it takes a request object,
// returns a response object and knows nothing about `http`. That is what lets
// the same code serve the CLI over a socket and drive the request runner in
// the browser demo, tests included.
import { createResolver, parseSpec, specInfo } from "./spec.js";
import { coerce, validate, validateQuery } from "./schema.js";
import { hashString, mulberry32 } from "./fake.js";
import { compileRoutes, matchRoute, seedItems, shapeList } from "./router.js";
import { createStore } from "./store.js";

const MUTATING = new Set(["POST", "PUT", "PATCH"]);

function json(status, body, headers = {}) {
  return { status, body, headers: { "content-type": "application/json", ...headers } };
}

function fail(status, error, extra = {}) {
  return json(status, { error, ...extra });
}

function latencyFor(config, rng) {
  const base = Math.max(0, Number(config.latency) || 0);
  if (!base) return 0;
  const jitter = Math.max(0, Math.min(0.9, Number(config.jitter) ?? 0.3));
  return Math.round(base * (1 - jitter + rng() * jitter * 2));
}

/**
 * Create a mock from a parsed OpenAPI document.
 *
 * @param {object} options
 * @param {object} options.spec parsed OpenAPI document
 * @param {number} [options.seed] seed for fixtures and failure injection
 * @param {object} [options.scenario] latency / errorRate / rateLimit controls
 */
export function createMockForge({ spec, seed = 7, scenario = {} } = {}) {
  if (!spec || typeof spec !== "object") throw new Error("createMockForge needs a parsed spec");
  const resolver = createResolver(spec);
  const routes = compileRoutes(spec, resolver);
  const store = createStore({ seed });
  const config = { latency: 0, jitter: 0.3, errorRate: 0, rateLimit: null, ...scenario };
  const recorder = [];
  const rateLog = [];
  const seeded = new Set();
  let counter = 0;

  const collectionRoute = (resource) =>
    routes.find((route) => route.resource === resource && route.method === "GET" && route.keys.length === 0);
  const itemRoute = (resource) => routes.find((route) => route.resource === resource && route.keys.length > 0);

  function seedResource(resource, count = 12) {
    if (!resource || seeded.has(resource)) return;
    seeded.add(resource);
    const route = collectionRoute(resource) || itemRoute(resource);
    if (!route) return;
    const items = seedItems(route, resolver, { count, seed });
    for (const item of items) {
      if (item && typeof item === "object" && (item.id === undefined || item.id === null)) item.id = store.nextId(resource);
    }
    store.seed(resource, items);
  }

  function listBody(route, resource, query) {
    seedResource(resource);
    return shapeList(route, store.list(resource), query);
  }

  function handleGet(route, params, query) {
    const resource = route.resource;
    if (!resource) return json(200, { method: "GET", path: route.path, params });
    if (route.keys.length) {
      seedResource(resource);
      const item = store.get(resource, params[route.keys[0]]);
      return item ? json(200, item) : fail(404, "Not found", { resource, id: params[route.keys[0]] });
    }
    return json(200, listBody(route, resource, query));
  }

  function handleMutation(route, method, params, query, body) {
    const resource = route.resource;
    if (!resource) return json(200, { method, path: route.path, body });

    if (method === "POST") {
      if (route.keys.length) return fail(405, `POST is not supported on ${route.path}`);
      seedResource(resource);
      const templateRoute = collectionRoute(resource) || route;
      const template = templateRoute.sample && typeof templateRoute.sample === "object" ? templateRoute.sample : {};
      const created = store.insert(resource, { ...template, ...(body && typeof body === "object" ? body : {}) });
      return json(201, created, { location: `/${resource}/${created.id}` });
    }

    seedResource(resource);
    const id = route.keys.length ? params[route.keys[0]] : query.id;
    if (!id) return fail(400, "A path parameter is required for this operation");
    const existing = store.get(resource, id);
    if (!existing) return fail(404, "Not found", { resource, id });

    if (method === "PUT") {
      const replacement = { ...(body && typeof body === "object" ? body : {}), id: existing.id };
      return json(200, store.update(resource, id, replacement));
    }
    if (method === "PATCH") {
      return json(200, store.update(resource, id, body && typeof body === "object" ? body : {}));
    }
    if (method === "DELETE") {
      store.remove(resource, id);
      return { status: 204, body: null, headers: {} };
    }
    return json(405, `Method ${method} is not supported`);
  }

  function routeRequest(method, pathname, params, query, body) {
    const match = matchRoute(routes, method, pathname);
    if (match.error === 404) {
      return fail(404, "No mock route matches this request", {
        method,
        path: pathname,
        routes: routes.map((route) => `${route.method} ${route.path}`),
      });
    }
    if (match.error === 405) {
      return fail(405, `Method ${method} is not allowed on ${pathname}`, { allowed: match.allowed });
    }
    const { route, params: rawParams } = match;

    const details = [];
    const coerced = {};
    for (const [key, raw] of Object.entries(rawParams)) {
      const definition = route.parameters.find((parameter) => parameter.in === "path" && parameter.name === key);
      const result = coerce(raw, definition?.schema || { type: "string" }, resolver);
      if (!result.ok) details.push({ path: `path.${key}`, message: result.message });
      else coerced[key] = result.value;
    }
    if (details.length) return json(400, { error: "Path parameter validation failed", details });

    const queryResult = validateQuery(query, route.parameters, resolver);
    if (queryResult.errors.length) {
      return json(400, { error: "Query parameter validation failed", details: queryResult.errors });
    }

    const bodySchema = route.requestBody
      ? (() => {
        const content = route.requestBody.content || {};
        const media = content["application/json"] || Object.values(content)[0];
        return media?.schema ? resolver.resolve(media.schema) : null;
      })()
      : null;

    if (bodySchema) {
      const missingBody = body === undefined || body === null || body === "";
      if (missingBody && route.requestBody.required && MUTATING.has(method)) {
        return json(400, { error: "Request body is required", details: [{ path: "$", message: "is required" }] });
      }
      if (!missingBody) {
        const bodyErrors = validate(body, bodySchema, { resolver, path: "$" });
        if (bodyErrors.length) return json(400, { error: "Request body validation failed", details: bodyErrors });
      }
    }

    if (method === "GET" || method === "HEAD") {
      const response = handleGet(route, coerced, query);
      return method === "HEAD" ? { ...response, body: null } : response;
    }
    if (method === "DELETE" || method === "PUT" || method === "PATCH" || method === "POST") {
      return handleMutation(route, method, coerced, query, body);
    }
    return fail(405, `Method ${method} is not supported`, { allowed: ["GET", "POST", "PUT", "PATCH", "DELETE"] });
  }

  async function handle(request = {}) {
    const started = Date.now();
    const requestNumber = ++counter;
    const method = String(request.method || "GET").toUpperCase();
    const rawPath = request.path || "/";
    const [pathname, search = ""] = rawPath.split("?");
    const query = { ...Object.fromEntries(new URLSearchParams(search)), ...(request.query || {}) };
    const rng = mulberry32(hashString(`${seed}:${requestNumber}:${method}:${pathname}`));

    let body = request.body;
    if (typeof body === "string" && body.trim()) {
      try {
        body = JSON.parse(body);
      } catch {
        const response = json(400, { error: "Request body is not valid JSON" });
        return finish(response, { started, requestNumber, method, pathname, query, body: request.body, injected: false, latency: 0 });
      }
    }

    let response;
    let injected = false;

    if (config.rateLimit) {
      const { limit, windowMs = 60_000 } = config.rateLimit;
      while (rateLog.length && rateLog[0] < Date.now() - windowMs) rateLog.shift();
      if (rateLog.length >= limit) {
        response = fail(429, "Rate limit exceeded", { limit, windowMs });
        response.headers = { ...response.headers, "retry-after": String(Math.ceil(windowMs / 1000)) };
      }
    }

    if (!response && Number(config.errorRate) > 0 && rng() < Number(config.errorRate)) {
      injected = true;
      response = json(500, {
        error: "Injected server error",
        code: "MOCK_ERROR_INJECTION",
        hint: "Set errorRate to 0 in the scenario controls to stop failures.",
      });
    }

    if (!response) {
      rateLog.push(Date.now());
      try {
        response = routeRequest(method, pathname, {}, query, body);
      } catch (error) {
        response = json(500, { error: "Mock server error", message: error.message });
      }
    }

    const latency = latencyFor(config, rng);
    if (latency) await new Promise((resolve) => setTimeout(resolve, latency));
    return finish(response, { started, requestNumber, method, pathname, query, body, injected, latency });
  }

  function finish(response, meta) {
    const requestId = `req_${String(meta.requestNumber).padStart(3, "0")}`;
    const entry = {
      id: requestId,
      at: meta.started,
      method: meta.method,
      path: meta.pathname,
      query: meta.query,
      body: meta.body ?? null,
      status: response.status,
      ms: Date.now() - meta.started,
      latency: meta.latency,
      injected: meta.injected,
      response: response.body,
    };
    recorder.push(entry);
    if (recorder.length > 200) recorder.shift();
    return {
      ...response,
      requestId,
      latency: meta.latency,
      headers: {
        "content-type": "application/json",
        "x-mockforge-request": requestId,
        "x-mockforge-latency": String(meta.latency),
        ...response.headers,
      },
    };
  }

  return {
    spec,
    seed,
    routes,
    resolver,
    store,
    info() {
      return { ...specInfo(spec), routes: routes.length, resources: store.stats(), seed };
    },
    getScenario() {
      return { ...config };
    },
    setScenario(patch = {}) {
      if ("latency" in patch) config.latency = Math.max(0, Number(patch.latency) || 0);
      if ("jitter" in patch) config.jitter = Math.max(0, Math.min(0.9, Number(patch.jitter) || 0));
      if ("errorRate" in patch) config.errorRate = Math.max(0, Math.min(1, Number(patch.errorRate) || 0));
      if ("rateLimit" in patch) config.rateLimit = patch.rateLimit;
      return this.getScenario();
    },
    getRequests: () => [...recorder].reverse(),
    reset() {
      store.reset();
      seeded.clear();
      recorder.length = 0;
      rateLog.length = 0;
      return this.info();
    },
    handle,
  };
}

/** Convenience for scripts: parse text and create a mock in one call. */
export function mockFromSpecText(text, options = {}) {
  return createMockForge({ spec: parseSpec(text), ...options });
}
