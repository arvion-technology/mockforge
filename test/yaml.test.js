import test from "node:test";
import assert from "node:assert/strict";

import { parseYaml } from "../src/yaml.js";

test("parses nested mappings and sequences", () => {
  const document = parseYaml(`paths:
  /tasks:
    get:
      summary: List tasks
      parameters:
        - name: status
          in: query
          required: true
        - name: limit
          in: query
`);
  assert.equal(document.paths["/tasks"].get.summary, "List tasks");
  assert.equal(document.paths["/tasks"].get.parameters.length, 2);
  assert.equal(document.paths["/tasks"].get.parameters[0].required, true);
});

test("parses flow collections and quoted keys", () => {
  const document = parseYaml(`openapi: 3.0.3
responses: { "200": { description: ok }, 404: { description: gone } }
tags: [one, two, "three"]
mixed:
  - { id: 1, name: first }
  - id: 2
    name: second
`);
  assert.equal(document.responses[200].description, "ok");
  assert.deepEqual(document.tags, ["one", "two", "three"]);
  assert.deepEqual(document.mixed, [{ id: 1, name: "first" }, { id: 2, name: "second" }]);
});

test("coerces scalars and ignores comments", () => {
  const document = parseYaml(`# leading comment
count: 12
ratio: 0.5
enabled: true
missing: null
note: plain text # trailing comment
quoted: "value # not a comment"
`);
  assert.equal(document.count, 12);
  assert.equal(document.ratio, 0.5);
  assert.equal(document.enabled, true);
  assert.equal(document.missing, null);
  assert.equal(document.note, "plain text");
  assert.equal(document.quoted, "value # not a comment");
});

test("reads literal and folded block strings", () => {
  const document = parseYaml(`literal: |
  first line
  second line
folded: >-
  one
  two
`);
  assert.equal(document.literal, "first line\nsecond line\n");
  assert.equal(document.folded, "one two");
});

test("rejects tab indentation rather than misreading it", () => {
  assert.throws(() => parseYaml("root:\n\tchild: 1\n"), /tab indentation/);
});
