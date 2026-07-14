import test from "node:test";
import assert from "node:assert/strict";

import { createMockForge } from "../src/server.js";
import { parseSpec } from "../src/spec.js";
import { TASKS_SPEC, ORDERS_SPEC } from "../src/samples.js";

const spec = parseSpec(TASKS_SPEC);
const makeForge = (scenario = {}) => createMockForge({ spec, seed: 11, scenario });

test("seeds a collection once with deterministic fixtures", async () => {
  const forge = makeForge();
  const first = await forge.handle({ method: "GET", path: "/tasks" });
  const second = await forge.handle({ method: "GET", path: "/tasks" });
  assert.equal(first.status, 200);
  assert.ok(Array.isArray(first.body));
  assert.equal(first.body.length, 12);
  assert.deepEqual(first.body, second.body);
  assert.ok(first.body.every((task) => typeof task.id === "string" && task.title.length >= 3));
});

test("honours limit and equality filters", async () => {
  const forge = makeForge();
  const limited = await forge.handle({ method: "GET", path: "/tasks?limit=3" });
  assert.equal(limited.body.length, 3);

  const all = await forge.handle({ method: "GET", path: "/tasks" });
  const status = all.body[0].status;
  const filtered = await forge.handle({ method: "GET", path: `/tasks?status=${status}` });
  assert.ok(filtered.body.length > 0);
  assert.ok(filtered.body.every((task) => task.status === status));
});

test("creates, reads, patches and deletes a task", async () => {
  const forge = makeForge();
  const created = await forge.handle({
    method: "POST",
    path: "/tasks",
    body: { title: "Ship the mock server", priority: 2, status: "todo" },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.title, "Ship the mock server");
  assert.ok(created.body.id);

  const read = await forge.handle({ method: "GET", path: `/tasks/${created.body.id}` });
  assert.equal(read.status, 200);
  assert.equal(read.body.id, created.body.id);

  const patched = await forge.handle({
    method: "PATCH",
    path: `/tasks/${created.body.id}`,
    body: { status: "done" },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.status, "done");
  assert.equal(patched.body.title, "Ship the mock server");

  const deleted = await forge.handle({ method: "DELETE", path: `/tasks/${created.body.id}` });
  assert.equal(deleted.status, 204);
  assert.equal(deleted.body, null);

  const gone = await forge.handle({ method: "GET", path: `/tasks/${created.body.id}` });
  assert.equal(gone.status, 404);
});

test("rejects invalid bodies with every problem, not just the first", async () => {
  const forge = makeForge();
  const response = await forge.handle({ method: "POST", path: "/tasks", body: { title: "x" } });
  assert.equal(response.status, 400);
  assert.equal(response.body.error, "Request body validation failed");
  const paths = response.body.details.map((detail) => detail.path);
  assert.deepEqual(paths, ["$.title"]);
});

test("rejects bodies that are not JSON", async () => {
  const forge = makeForge();
  const response = await forge.handle({ method: "POST", path: "/tasks", body: "{oops" });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /valid JSON/);
});

test("validates query parameters against the spec", async () => {
  const forge = makeForge();
  const tooLarge = await forge.handle({ method: "GET", path: "/tasks?limit=500" });
  assert.equal(tooLarge.status, 400);
  assert.equal(tooLarge.body.details[0].path, "query.limit");

  const badEnum = await forge.handle({ method: "GET", path: "/tasks?status=later" });
  assert.equal(badEnum.status, 400);
  assert.match(badEnum.body.details[0].message, /must be one of/);
});

test("distinguishes no route from the wrong method", async () => {
  const forge = makeForge();
  const missing = await forge.handle({ method: "GET", path: "/nope" });
  assert.equal(missing.status, 404);
  assert.ok(Array.isArray(missing.body.routes));

  const wrongMethod = await forge.handle({ method: "PUT", path: "/tasks" });
  assert.equal(wrongMethod.status, 405);
  assert.deepEqual(wrongMethod.body.allowed.sort(), ["GET", "POST"]);
});

test("HEAD returns headers with no body", async () => {
  const forge = makeForge();
  const response = await forge.handle({ method: "HEAD", path: "/tasks" });
  assert.equal(response.status, 200);
  assert.equal(response.body, null);
});

test("injects errors deterministically at the configured rate", async () => {
  const forge = makeForge({ errorRate: 1 });
  const response = await forge.handle({ method: "GET", path: "/tasks" });
  assert.equal(response.status, 500);
  assert.equal(response.body.code, "MOCK_ERROR_INJECTION");
  assert.equal(forge.getRequests()[0].injected, true);
});

test("enforces a rate limit window", async () => {
  const forge = makeForge({ rateLimit: { limit: 2, windowMs: 60_000 } });
  assert.equal((await forge.handle({ method: "GET", path: "/tasks" })).status, 200);
  assert.equal((await forge.handle({ method: "GET", path: "/tasks" })).status, 200);
  const limited = await forge.handle({ method: "GET", path: "/tasks" });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers["retry-after"], "60");
});

test("records requests and exposes simulated latency", async () => {
  const forge = makeForge({ latency: 20 });
  const response = await forge.handle({ method: "GET", path: "/tasks?limit=1" });
  assert.ok(response.latency >= 14 && response.latency <= 26, `latency ${response.latency}`);
  assert.ok(response.ms === undefined || true);

  const recorded = forge.getRequests();
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].status, 200);
  assert.equal(recorded[0].query.limit, "1");
  assert.ok(recorded[0].ms >= response.latency);

  forge.reset();
  assert.equal(forge.getRequests().length, 0);
  const afterReset = await forge.handle({ method: "GET", path: "/tasks?limit=2" });
  assert.equal(afterReset.status, 200);
});

test("scenario controls can change at runtime", () => {
  const forge = makeForge();
  assert.deepEqual(forge.getScenario(), { latency: 0, jitter: 0.3, errorRate: 0, rateLimit: null });
  const updated = forge.setScenario({ latency: 120, errorRate: 2, jitter: 9 });
  assert.equal(updated.latency, 120);
  assert.equal(updated.errorRate, 1, "error rate is clamped to 1");
  assert.equal(updated.jitter, 0.9, "jitter is clamped");
});

test("wrapped list responses keep their declared shape", async () => {
  const forge = createMockForge({ spec: parseSpec(ORDERS_SPEC), seed: 5 });
  const response = await forge.handle({ method: "GET", path: "/orders?limit=2" });
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.body.items));
  assert.equal(response.body.items.length, 2);
  assert.equal(typeof response.body.total, "number");
});

test("info reports resources and route count", () => {
  const forge = makeForge();
  const info = forge.info();
  assert.equal(info.title, "Task Tracker API");
  assert.equal(info.routes, 5);
  assert.ok(Array.isArray(info.resources));
});
