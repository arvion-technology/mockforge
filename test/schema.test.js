import test from "node:test";
import assert from "node:assert/strict";

import { validate, coerce, validateQuery } from "../src/schema.js";
import { createResolver } from "../src/spec.js";

const resolver = createResolver({
  openapi: "3.0.3",
  paths: {},
  components: {
    schemas: {
      TaskInput: {
        type: "object",
        required: ["title", "priority"],
        properties: {
          title: { type: "string", minLength: 3, maxLength: 40 },
          priority: { type: "integer", minimum: 1, maximum: 5 },
          status: { type: "string", enum: ["todo", "done"] },
          email: { type: "string", format: "email" },
        },
        additionalProperties: false,
      },
    },
  },
});

test("validates required fields and reports their path", () => {
  const errors = validate({ title: "Write tests" }, { $ref: "#/components/schemas/TaskInput" }, { resolver });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].path, "$.priority");
  assert.match(errors[0].message, /required/);
});

test("validates types, bounds, enums and formats together", () => {
  const errors = validate(
    { title: "ok", priority: 9, status: "later", email: "not-an-email" },
    { $ref: "#/components/schemas/TaskInput" },
    { resolver },
  );
  const paths = errors.map((error) => error.path).sort();
  assert.deepEqual(paths, ["$.email", "$.priority", "$.status", "$.title"]);
  assert.ok(errors.some((error) => /at least 3/.test(error.message)));
});

test("rejects undeclared properties when additionalProperties is false", () => {
  const errors = validate(
    { title: "Valid title", priority: 2, admin: true },
    { $ref: "#/components/schemas/TaskInput" },
    { resolver },
  );
  assert.deepEqual(errors, [{ path: "$.admin", message: "is not an allowed property" }]);
});

test("accepts nullable fields and arrays with item schemas", () => {
  const schema = {
    type: "object",
    properties: {
      assignee: { type: "string", nullable: true },
      tags: { type: "array", maxItems: 2, items: { type: "string" } },
    },
  };
  assert.equal(validate({ assignee: null, tags: ["a", "b"] }, schema, { resolver }).length, 0);
  assert.equal(validate({ tags: ["a", "b", "c"] }, schema, { resolver })[0].path, "$.tags");
  assert.equal(validate({ tags: [1] }, schema, { resolver })[0].path, "$.tags[0]");
});

test("coerces query strings to declared types", () => {
  assert.deepEqual(coerce("42", { type: "integer" }, resolver), { ok: true, value: 42 });
  assert.deepEqual(coerce("true", { type: "boolean" }, resolver), { ok: true, value: true });
  assert.deepEqual(coerce("a,b", { type: "array", items: { type: "string" } }, resolver), { ok: true, value: ["a", "b"] });
  assert.equal(coerce("nope", { type: "integer" }, resolver).ok, false);
});

test("validateQuery aggregates required and invalid parameters", () => {
  const parameters = [
    { name: "status", in: "query", schema: { type: "string", enum: ["todo", "done"] } },
    { name: "limit", in: "query", required: true, schema: { type: "integer", minimum: 1, maximum: 10 } },
    { name: "trace", in: "header", required: true },
  ];
  const result = validateQuery({ limit: "99", status: "later", extra: "yes" }, parameters, resolver);
  assert.equal(result.errors.length, 2);
  assert.deepEqual(result.unknown, ["extra"]);

  const missing = validateQuery({}, parameters, resolver);
  assert.equal(missing.errors[0].path, "query.limit");
});
