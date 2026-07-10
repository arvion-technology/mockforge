import test from "node:test";
import assert from "node:assert/strict";

import { fakeValue, fakeList, mulberry32, hashString } from "../src/fake.js";
import { TASKS_SPEC } from "../src/samples.js";
import { createResolver, parseSpec } from "../src/spec.js";
import { validate } from "../src/schema.js";

const resolver = createResolver(JSON.parse(JSON.stringify({
  openapi: "3.0.3",
  paths: {},
  components: {
    schemas: {
      Task: {
        type: "object",
        required: ["id", "title", "status", "priority"],
        properties: {
          id: { type: "string" },
          title: { type: "string", minLength: 3 },
          status: { type: "string", enum: ["todo", "in_progress", "done"] },
          priority: { type: "integer", minimum: 1, maximum: 5 },
          email: { type: "string", format: "email" },
          createdAt: { type: "string", format: "date-time" },
          tags: { type: "array", maxItems: 3, items: { type: "string" } },
          owner: { $ref: "#/components/schemas/Owner" },
        },
      },
      Owner: {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" }, email: { type: "string", format: "email" } },
      },
    },
  },
})));

test("mulberry32 and hashString are deterministic", () => {
  const a = mulberry32(hashString("fixtures"));
  const b = mulberry32(hashString("fixtures"));
  assert.equal(a(), b());
  assert.equal(a(), b());
  assert.notEqual(hashString("fixtures"), hashString("fixtures2"));
});

test("fakeValue is stable for the same seed and field", () => {
  const schema = { $ref: "#/components/schemas/Task" };
  const first = fakeValue(schema, { seed: "tasks#3", resolver });
  const second = fakeValue(schema, { seed: "tasks#3", resolver });
  assert.deepEqual(first, second);
  const other = fakeValue(schema, { seed: "tasks#4", resolver });
  assert.notDeepEqual(first, other);
});

test("generated values satisfy the schema they came from", () => {
  const schema = { $ref: "#/components/schemas/Task" };
  for (let index = 0; index < 5; index++) {
    const value = fakeValue(schema, { seed: `task-${index}`, resolver });
    assert.deepEqual(validate(value, schema, { resolver }), []);
  }
});

test("enums are respected and formats look real", () => {
  const statuses = new Set();
  for (let index = 0; index < 30; index++) {
    statuses.add(fakeValue({ type: "string", enum: ["todo", "in_progress", "done"] }, { seed: `status-${index}`, resolver }));
  }
  assert.deepEqual([...statuses].sort(), ["done", "in_progress", "todo"]);

  const email = fakeValue({ type: "string", format: "email" }, { seed: "email", field: "email", resolver });
  assert.match(email, /^[^@\s]+@[^@\s]+\.[^@\s]+$/);
  const uuid = fakeValue({ type: "string", format: "uuid" }, { seed: "u", resolver });
  assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const date = fakeValue({ type: "string", format: "date" }, { seed: "d", resolver });
  assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
});

test("numeric bounds and array limits are honoured", () => {
  for (let index = 0; index < 20; index++) {
    const priority = fakeValue({ type: "integer", minimum: 1, maximum: 5 }, { seed: `p-${index}`, field: "priority", resolver });
    assert.ok(priority >= 1 && priority <= 5, `priority ${priority} out of range`);
    const tags = fakeValue({ type: "array", maxItems: 3, items: { type: "string" } }, { seed: `t-${index}`, field: "tags", resolver });
    assert.ok(Array.isArray(tags) && tags.length <= 3);
  }
});

test("fakeList returns independent deterministic records", () => {
  const schema = { $ref: "#/components/schemas/Task" };
  const first = fakeList(schema, { count: 4, seed: "fixtures", resolver });
  const second = fakeList(schema, { count: 4, seed: "fixtures", resolver });
  assert.deepEqual(first, second);
  assert.equal(first.length, 4);
  assert.notDeepEqual(first[0], first[1]);
});

test("the task sample resolves refs through the faker", () => {
  const taskResolver = createResolver(parseSpec(TASKS_SPEC));
  const value = fakeValue({ $ref: "#/components/schemas/Task" }, { seed: "sample", resolver: taskResolver });
  assert.ok(value.title.length >= 3);
  assert.ok(["todo", "in_progress", "done"].includes(value.status));
  assert.ok(value.createdAt.endsWith("Z"));
});
