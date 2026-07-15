import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  parseSpec,
  specInfo,
  resolvePointer,
  createResolver,
  listOperations,
  serverBasePath,
} from "../src/spec.js";
import { TASKS_SPEC } from "../src/samples.js";

test("parseSpec reads the YAML sample", () => {
  const spec = parseSpec(TASKS_SPEC);
  assert.equal(spec.openapi, "3.0.3");
  assert.equal(spec.info.title, "Task Tracker API");
  assert.deepEqual(Object.keys(spec.paths), ["/tasks", "/tasks/{taskId}"]);
  assert.equal(spec.components.schemas.Task.properties.priority.maximum, 5);
});

test("parseSpec accepts JSON documents", () => {
  const spec = parseSpec(JSON.stringify({
    openapi: "3.0.0",
    paths: { "/ping": { get: { responses: { 200: { description: "pong" } } } } },
  }));
  assert.deepEqual(Object.keys(spec.paths), ["/ping"]);
});

test("parseSpec rejects documents without paths", () => {
  assert.throws(() => parseSpec("openapi: 3.0.3\ninfo:\n  title: Bare\n"), /no 'paths'/);
  assert.throws(() => parseSpec("this: is not openapi"), /missing an 'openapi'/);
});

test("resolvePointer follows JSON Pointer escapes", () => {
  const document = { components: { schemas: { "a/b": { "~tilt": { type: "string" } } } } };
  assert.equal(resolvePointer(document, "#/components/schemas/a~1b/~0tilt").type, "string");
  assert.equal(resolvePointer(document, "#/components/schemas/missing"), undefined);
});

test("createResolver inlines every local $ref", () => {
  const spec = {
    openapi: "3.0.3",
    paths: {},
    components: {
      schemas: {
        Task: { type: "object", properties: { owner: { $ref: "#/components/schemas/User" } } },
        User: { type: "object", properties: { name: { type: "string" } } },
      },
    },
  };
  const resolved = createResolver(spec).resolve({ $ref: "#/components/schemas/Task" });
  assert.equal(resolved.type, "object");
  assert.equal(resolved.properties.owner.properties.name.type, "string");
});

test("createResolver refuses remote refs with a clear error", () => {
  const spec = { openapi: "3.0.3", paths: {}, components: { schemas: {} } };
  assert.throws(
    () => createResolver(spec).resolve({ $ref: "https://example.com/schema.json" }),
    /only local \$refs/,
  );
  assert.throws(
    () => createResolver(spec).resolve({ $ref: "#/components/schemas/Nope" }),
    /unresolved \$ref/,
  );
});

test("createResolver marks a circular schema instead of looping", () => {
  const spec = {
    openapi: "3.0.3",
    paths: {},
    components: {
      schemas: {
        Node: { type: "object", properties: { child: { $ref: "#/components/schemas/Node" } } },
      },
    },
  };
  const resolved = createResolver(spec).resolve({ $ref: "#/components/schemas/Node" });
  assert.equal(resolved.type, "object");
  assert.equal(resolved.properties.child.circular, true);
});

test("listOperations merges path-level parameters", () => {
  const spec = parseSpec(TASKS_SPEC);
  const operations = listOperations(spec);
  const getOne = operations.find((operation) => operation.method === "GET" && operation.path === "/tasks/{taskId}");
  assert.ok(getOne);
  assert.equal(getOne.parameters.find((parameter) => parameter.name === "taskId").in, "path");
  const list = operations.find((operation) => operation.method === "GET" && operation.path === "/tasks");
  assert.deepEqual(list.parameters.map((parameter) => parameter.name), ["status", "limit"]);
});

test("specInfo and serverBasePath describe the document", () => {
  const spec = parseSpec(TASKS_SPEC);
  const info = specInfo(spec);
  assert.equal(info.title, "Task Tracker API");
  assert.equal(info.pathCount, 2);
  assert.equal(serverBasePath(spec), "/v1");
  assert.equal(serverBasePath({ servers: [] }), "");
});

test("the shipped example file matches the in-app sample", () => {
  const fromFile = parseSpec(readFileSync("examples/tasks.yaml", "utf8"));
  const fromModule = parseSpec(TASKS_SPEC);
  assert.deepEqual(fromFile, fromModule);
});
