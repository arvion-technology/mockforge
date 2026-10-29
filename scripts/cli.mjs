#!/usr/bin/env node
// MockForge CLI, `mockforge serve spec.yaml` starts the stateful mock.
//
// The HTTP layer is deliberately thin: it only translates between Node's
// IncomingMessage and the plain request/response objects the core understands.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { parseSpec, specInfo } from "../src/spec.js";
import { createMockForge } from "../src/server.js";
import { describeRoute } from "../src/router.js";

const USAGE = `mockforge, serve a stateful mock API from an OpenAPI 3 document

Usage
  mockforge serve <spec.yaml> [options]
  mockforge list <spec.yaml>

Options for serve
  --port <n>         Port to listen on (default 4010)
  --seed <n>         Fixture seed (default 7)
  --latency <ms>     Simulated latency for every response (default 0)
  --error-rate <r>   Fraction of requests answered with a 500, 0..1 (default 0)
  --quiet            Only print the listening line

Examples
  npx mockforge serve examples/tasks.yaml --port 4010
  npx mockforge serve examples/tasks.yaml --latency 150 --error-rate 0.05
  npx mockforge list examples/tasks.yaml
`;

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  const positional = [];
  for (let index = 0; index < rest.length; index++) {
    const argument = rest[index];
    if (!argument.startsWith("--")) {
      positional.push(argument);
      continue;
    }
    const key = argument.slice(2);
    if (key === "help" || key === "quiet") flags[key] = true;
    else flags[key] = rest[++index];
  }
  return { command, positional, flags };
}

function loadSpec(file) {
  if (!file) {
    console.error("mockforge: missing spec file\n\n" + USAGE);
    process.exit(2);
  }
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    console.error(`mockforge: cannot read ${file}`);
    process.exit(2);
  }
  try {
    return parseSpec(text);
  } catch (error) {
    console.error(`mockforge: ${file}: ${error.message}`);
    process.exit(2);
  }
}

function printRoutes(spec, log = console.log) {
  const forge = createMockForge({ spec });
  for (const route of forge.routes) {
    const description = describeRoute(route, forge.resolver);
    const query = description.query.length
      ? `  query: ${description.query.map((parameter) => parameter.name + (parameter.required ? "*" : "")).join(", ")}`
      : "";
    log(`${route.method.padEnd(6)} ${route.path.padEnd(22)} ${description.summary || ""}${query}`);
  }
}

function listCommand(file) {
  const spec = loadSpec(file);
  const info = specInfo(spec);
  console.log(`${info.title} ${info.version ? "v" + info.version : ""}, ${info.openapi}, ${info.pathCount} paths`);
  printRoutes(spec);
}

async function serveCommand(file, flags) {
  const spec = loadSpec(file);
  const port = Number(flags.port || process.env.PORT || 4010);
  const seed = Number(flags.seed || 7);
  const latency = Number(flags.latency || 0);
  const errorRate = Number(flags["error-rate"] || 0);
  const forge = createMockForge({ spec, seed, scenario: { latency, errorRate } });
  const info = specInfo(spec);

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");

    let body;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }

    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders());
      response.end();
      return;
    }

    const result = await forge.handle({
      method: request.method,
      path: url.pathname + url.search,
      query: Object.fromEntries(url.searchParams),
      headers: request.headers,
      body,
    });

    response.writeHead(result.status, { ...corsHeaders(), ...result.headers });
    if (result.body === null || result.status === 204) response.end();
    else response.end(JSON.stringify(result.body));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, resolve);
  });

  if (!flags.quiet) {
    console.log(`${info.title}, mock serving ${forge.routes.length} routes`);
    printRoutes(spec);
  }
  console.log(`mockforge listening on http://localhost:${port}`);
  if (!flags.quiet && spec.servers?.[0]?.url) {
    console.log(`spec advertises ${spec.servers[0].url}; requests go to the local port above`);
  }

  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const corsHeaders = () => ({
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS",
  "access-control-allow-headers": "content-type,authorization",
});

const { command, positional, flags } = parseArguments(process.argv.slice(2));
if (command === "serve") {
  await serveCommand(positional[0], flags);
} else if (command === "list") {
  listCommand(positional[0]);
} else if (command === "help" || command === "--help" || flags.help || !command) {
  console.log(USAGE);
} else {
  console.error(`mockforge: unknown command "${command}"\n\n${USAGE}`);
  process.exit(2);
}
