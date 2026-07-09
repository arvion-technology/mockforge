import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("list prints every operation with its query parameters", () => {
  const output = execFileSync(process.execPath, ["scripts/cli.mjs", "list", "examples/tasks.yaml"], { encoding: "utf8" });
  assert.match(output, /Task Tracker API/);
  assert.match(output, /GET\s+\/tasks\s+List tasks/);
  assert.match(output, /query: status, limit/);
  assert.match(output, /PATCH\s+\/tasks\/\{taskId\}/);
});

test("serve answers HTTP requests from the generated routes", async (t) => {
  const port = await freePort();
  const child = spawn(process.execPath, [
    "scripts/cli.mjs", "serve", "examples/tasks.yaml",
    "--port", String(port), "--quiet", "--latency", "0",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  t.after(() => child.kill("SIGKILL"));

  let response = null;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      response = await fetch(`http://127.0.0.1:${port}/tasks?limit=2`);
      break;
    } catch {
      await wait(100);
    }
  }
  assert.ok(response, `mock server did not start: ${stderr}`);
  assert.equal(response.status, 200);
  const tasks = await response.json();
  assert.equal(tasks.length, 2);

  const created = await fetch(`http://127.0.0.1:${port}/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Verify through the CLI" }),
  });
  assert.equal(created.status, 201);
  const task = await created.json();
  assert.equal(task.title, "Verify through the CLI");

  const invalid = await fetch(`http://127.0.0.1:${port}/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "no" }),
  });
  assert.equal(invalid.status, 400);
  const problem = await invalid.json();
  assert.equal(problem.details[0].path, "$.title");
});
