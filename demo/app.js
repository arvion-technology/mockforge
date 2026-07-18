// MockForge demo application.
//
// The server, the spec parser, the validator and the fake-data generator are
// all imported from ../src — this file only moves request objects between the
// DOM and that library. Nothing here sends a network request.
import { parseSpec, specInfo } from "../src/spec.js";
import { createMockForge } from "../src/server.js";
import { SAMPLE_SPECS } from "../src/samples.js";

const { el, $, $$, toast, fmt } = A;

const state = {
  sampleId: "tasks",
  forge: null,
  spec: null,
  selectedRoute: null,
  seed: 7,
  latency: 90,
  errorRate: 0,
  view: "playground",
  selectedRequest: null,
};

const statusTone = (status) => (status < 300 ? "ok" : status < 400 ? "warn" : "err");
const statusClass = (status) => `badge status-${Math.min(5, Math.floor(status / 100))}`;

/* ------------------------------------------------------------------ spec */

function chooseSample(id) {
  const sample = SAMPLE_SPECS.find((entry) => entry.id === id) || SAMPLE_SPECS[0];
  state.sampleId = sample.id;
  $("#spec-editor").value = sample.yaml;
  renderSampleChips();
  reloadSpec({ prime: false });
}

function renderSampleChips() {
  $("#sample-chips").replaceChildren(...SAMPLE_SPECS.map((sample) =>
    el("button", {
      class: "chip" + (sample.id === state.sampleId ? " active" : ""),
      title: sample.blurb,
      onclick: () => chooseSample(sample.id),
    }, sample.name)));
}

function showParseError(message) {
  const box = $("#parse-error");
  box.textContent = message;
  box.classList.remove("hide");
  $("#parse-status").textContent = "Spec could not be parsed — the previous server is still running";
  $("#parse-status").style.color = "var(--red)";
}

function clearParseError() {
  $("#parse-error").classList.add("hide");
  $("#parse-status").style.color = "";
}

function reloadSpec({ prime = false } = {}) {
  const text = $("#spec-editor").value;
  const started = performance.now();
  let spec;
  try {
    spec = parseSpec(text);
  } catch (error) {
    showParseError(error.message);
    return;
  }
  clearParseError();
  state.spec = spec;
  state.forge = createMockForge({
    spec,
    seed: state.seed,
    scenario: { latency: state.latency, errorRate: state.errorRate },
  });
  const info = specInfo(spec);
  const elapsed = performance.now() - started;
  $("#spec-badge").textContent = `OpenAPI ${info.openapi}`;
  $("#spec-meta").textContent = `${info.title}${info.version ? " v" + info.version : ""}`;
  $("#spec-meta").className = "badge gold";
  $("#parse-status").textContent = `Parsed ${state.forge.routes.length} operations from ${info.pathCount} paths`;
  $("#parse-ms").textContent = `${elapsed.toFixed(1)} ms`;
  $("#routes-sub").textContent = `${info.title} — click a route to load it into the runner`;
  $("#route-count").textContent = `${state.forge.routes.length} operations`;
  renderRoutes();
  renderStoreChips();
  renderRecorder();
  const first = state.forge.routes.find((route) => route.method === "GET" && route.keys.length === 0) || state.forge.routes[0];
  if (first) selectRoute(first);
  if (prime) primePlayground();
}

/* --------------------------------------------------------------- routes */

function routePath(route) {
  return route.path.replace(/\{([^}]+)\}/g, (_, key) => {
    const items = state.forge.store.list(route.resource);
    return encodeURIComponent(items[0] ? items[0].id : "missing");
  });
}

function selectRoute(route) {
  state.selectedRoute = route;
  $("#req-method").value = route.method;
  let path = routePath(route);
  const hasLimit = route.parameters.some((parameter) => parameter.in === "query" && parameter.name === "limit");
  if (route.keys.length === 0 && hasLimit) path += "?limit=3";
  $("#req-path").value = path;
  toggleBodyEditor();
  if (route.sample !== null && route.sample !== undefined) {
    $("#req-body").value = JSON.stringify(route.sample, null, 2);
  } else if (route.method === "POST" || route.method === "PATCH" || route.method === "PUT") {
    $("#req-body").value = "{}";
  }
  renderRoutes();
}

function renderRoutes() {
  if (!state.forge) return;
  $("#route-list").replaceChildren(...state.forge.routes.map((route) =>
    el("button", {
      class: "route-row" + (route === state.selectedRoute ? " active" : ""),
      onclick: () => selectRoute(route),
      title: route.summary,
    },
    el("span", { class: "method " + route.method.toLowerCase(), text: route.method }),
    el("span", { class: "route-path mono", text: route.path }),
    el("span", { class: "route-summary muted", text: route.summary }))));
}

function toggleBodyEditor() {
  const method = $("#req-method").value;
  const needsBody = !["GET", "DELETE", "HEAD"].includes(method);
  $("#body-wrap").classList.toggle("hide", !needsBody);
}

function renderStoreChips() {
  if (!state.forge) return;
  const resources = state.forge.store.stats();
  const chips = resources.length
    ? resources.map((entry) => el("span", { class: "chip" }, el("span", { text: entry.name }), el("span", { class: "mono", text: String(entry.count) })))
    : [el("span", { class: "small muted", text: "Store is empty — send a POST to create a record" })];
  $("#store-chips").replaceChildren(...chips);
}

/* -------------------------------------------------------------- runner */

function renderResponse(response, elapsed) {
  const duration = Number.isFinite(elapsed) ? Math.round(elapsed) : (response.latency ?? 0);
  const status = $("#last-status");
  status.textContent = String(response.status);
  status.className = statusClass(response.status);
  $("#resp-meta").textContent = `${response.status < 400 ? "ok" : "error"} · ${duration} ms · simulated ${response.latency ?? 0} ms · ${response.requestId}`;
  const body = response.body;
  $("#response").textContent = body === null || body === undefined
    ? "(empty body)"
    : JSON.stringify(body, null, 2).slice(0, 6000);
}

async function sendRequest() {
  if (!state.forge) {
    toast("Load a spec first", "error");
    return;
  }
  const method = $("#req-method").value;
  let body;
  const bodyText = $("#req-body").value.trim();
  if (bodyText && !["GET", "HEAD"].includes(method)) {
    try {
      body = JSON.parse(bodyText);
    } catch (error) {
      toast("Request body is not valid JSON", "error");
      return;
    }
  }
  const button = $("#send");
  button.disabled = true;
  button.textContent = "Sending…";
  const started = performance.now();
  try {
    const response = await state.forge.handle({ method, path: $("#req-path").value.trim() || "/", body });
    renderResponse(response, performance.now() - started);
    renderRecorder();
    renderStoreChips();
    if (state.view === "traffic") renderTraffic();
  } finally {
    button.disabled = false;
    button.textContent = "Send";
  }
}

/* ------------------------------------------------------------ recorder */

function statusPill(status) {
  return el("span", { class: "status-pill " + statusTone(status), text: String(status) });
}

function renderMiniRecorder() {
  const requests = state.forge ? state.forge.getRequests().slice(0, 6) : [];
  if (!requests.length) {
    $("#mini-recorder").replaceChildren(el("div", { class: "empty" }, el("strong", { text: "No traffic yet" }), "Send a request to record it here."));
    return;
  }
  const table = el("table", { class: "mini-table" },
    el("thead", {}, el("tr", {},
      el("th", { text: "Method" }), el("th", { text: "Path" }), el("th", { class: "right", text: "Status" }), el("th", { class: "right", text: "ms" }))),
    el("tbody", {}, ...requests.map((request) =>
      el("tr", {},
        el("td", {}, el("span", { class: "method " + request.method.toLowerCase(), text: request.method })),
        el("td", { class: "path-cell", text: request.path }),
        el("td", { class: "right" }, statusPill(request.status)),
        el("td", { class: "right", text: String(request.ms) }))))); 
  $("#mini-recorder").replaceChildren(table);
}

function renderRecorder() {
  renderMiniRecorder();
  if (state.view === "traffic") renderTraffic();
}

/* -------------------------------------------------------------- traffic */

function trafficStats() {
  const requests = state.forge ? state.forge.getRequests() : [];
  const successes = requests.filter((request) => request.status < 400).length;
  const injected = requests.filter((request) => request.injected).length;
  const average = requests.length ? Math.round(requests.reduce((sum, request) => sum + request.ms, 0) / requests.length) : 0;
  return { total: requests.length, successes, injected, average };
}

function statCard(label, value, sub, tone = "") {
  return el("div", { class: "card traffic-stat" },
    el("div", { class: "stat" },
      el("div", { class: "stat-label", text: label }),
      el("div", { class: "stat-value " + tone, text: value }),
      el("div", { class: "small muted", text: sub })));
}

function renderTraffic() {
  if (!state.forge) return;
  const requests = state.forge.getRequests();
  const stats = trafficStats();
  $("#traffic-stats").replaceChildren(
    statCard("Recorded requests", String(stats.total), "capped at the last 200"),
    statCard("Successful", stats.total ? fmt.pct(stats.successes / stats.total, 0) : "—", "status below 400", "green"),
    statCard("Injected failures", String(stats.injected), "errors the scenario forced", stats.injected ? "gold" : ""),
    statCard("Mean duration", `${stats.average} ms`, "wall clock, simulation included", "blue"),
  );

  if (!requests.length) {
    $("#traffic-table").replaceChildren(el("div", { class: "empty", style: "margin:20px" }, el("strong", { text: "Nothing recorded yet" }), "Run a request in the playground."));
    return;
  }

  const table = el("table", { class: "table" },
    el("thead", {}, el("tr", {},
      el("th", { text: "#" }), el("th", { text: "Method" }), el("th", { text: "Path" }),
      el("th", { text: "Status" }), el("th", { class: "num", text: "Duration" }), el("th", { text: "Scenario" }))),
    el("tbody", {}, ...requests.map((request) =>
      el("tr", {
        class: state.selectedRequest && state.selectedRequest.id === request.id ? "selected" : "",
        onclick: () => {
          state.selectedRequest = request;
          renderTraffic();
          renderDetail(request);
        },
      },
      el("td", { class: "mono", text: request.id }),
      el("td", {}, el("span", { class: "method " + request.method.toLowerCase(), text: request.method })),
      el("td", { class: "mono", text: request.path }),
      el("td", {}, statusPill(request.status)),
      el("td", { class: "num", text: request.ms + " ms" }),
      el("td", {}, el("span", { class: "badge " + (request.injected ? "red" : ""), text: request.injected ? "injected 500" : "normal" }))))));

  $("#traffic-table").replaceChildren(el("div", { class: "table-wrap" }, table));
}

function renderDetail(request) {
  $("#detail-id").textContent = request.id;
  $("#request-detail").replaceChildren(
    el("div", {},
      el("dl", { class: "kv" },
        el("dt", { text: "Method" }), el("dd", { text: request.method }),
        el("dt", { text: "Path" }), el("dd", { class: "mono", text: request.path }),
        el("dt", { text: "Status" }), el("dd", { text: String(request.status) }),
        el("dt", { text: "Duration" }), el("dd", { text: `${request.ms} ms` }),
        el("dt", { text: "Simulated" }), el("dd", { text: `${request.latency} ms` }),
        el("dt", { text: "Injected" }), el("dd", { text: request.injected ? "yes" : "no" }))),
    el("div", { class: "detail-block" },
      el("h4", { text: "Request" }),
      el("pre", { class: "code", text: JSON.stringify({ query: request.query, body: request.body }, null, 2) })),
    el("div", { class: "detail-block" },
      el("h4", { text: "Response" }),
      el("pre", { class: "code", text: request.response === null ? "(empty body)" : JSON.stringify(request.response, null, 2).slice(0, 5000) })),
  );
}

/* ---------------------------------------------------------------- views */

function setView(view, { updateHash = true } = {}) {
  state.view = view;
  $$("[data-view-panel]").forEach((panel) => { panel.hidden = panel.dataset.viewPanel !== view; });
  $$("#view-tabs .tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  if (updateHash) history.replaceState(null, "", view === "traffic" ? "#traffic" : "#playground");
  if (view === "traffic") renderTraffic();
}

/* -------------------------------------------------------------- priming */

async function primePlayground() {
  await state.forge.handle({ method: "GET", path: "/tasks?limit=3" });
  const response = await state.forge.handle({ method: "GET", path: "/tasks?limit=3" });
  renderResponse(response, response.ms);
  renderStoreChips();
  renderRecorder();
}

async function primeTraffic() {
  await state.forge.handle({ method: "GET", path: "/tasks?limit=3" });
  const created = await state.forge.handle({
    method: "POST",
    path: "/tasks",
    body: { title: "Investigate latency spike", priority: 2, status: "todo" },
  });
  await state.forge.handle({ method: "GET", path: `/tasks/${created.body.id}` });
  await state.forge.handle({ method: "POST", path: "/tasks", body: { title: "x" } });
  const patched = await state.forge.handle({
    method: "PATCH",
    path: `/tasks/${created.body.id}`,
    body: { status: "done" },
  });
  renderResponse(patched, patched.ms);
  state.selectedRequest = state.forge.getRequests()[0];
  renderTraffic();
  if (state.selectedRequest) renderDetail(state.selectedRequest);
}

/* ------------------------------------------------------------------ boot */

function bindEvents() {
  $$("#view-tabs .tab").forEach((tab) => tab.addEventListener("click", () => setView(tab.dataset.view)));
  $("#send").addEventListener("click", sendRequest);
  $("#req-path").addEventListener("keydown", (event) => { if (event.key === "Enter") sendRequest(); });
  $("#req-method").addEventListener("change", toggleBodyEditor);
  $("#reset-store").addEventListener("click", () => {
    if (!state.forge) return;
    state.forge.reset();
    state.selectedRequest = null;
    renderStoreChips();
    renderRecorder();
    toast("Store reset — fixtures regenerate on the next request", "success");
  });
  $("#open-traffic").addEventListener("click", () => setView("traffic"));
  $("#latency").addEventListener("input", (event) => {
    state.latency = Number(event.target.value);
    $("#latency-value").textContent = `${state.latency} ms`;
    if (state.forge) state.forge.setScenario({ latency: state.latency });
  });
  $("#error-rate").addEventListener("input", (event) => {
    state.errorRate = Number(event.target.value) / 100;
    $("#error-value").textContent = `${event.target.value}%`;
    if (state.forge) state.forge.setScenario({ errorRate: state.errorRate });
  });
  $("#seed").addEventListener("change", (event) => {
    state.seed = Math.max(1, Number(event.target.value) || 1);
    reloadSpec();
  });
  const editor = $("#spec-editor");
  editor.addEventListener("input", A.debounce(() => {
    const matches = SAMPLE_SPECS.find((sample) => sample.yaml === editor.value);
    state.sampleId = matches ? matches.id : null;
    renderSampleChips();
    reloadSpec();
  }, 420));
}

function init() {
  $("#spec-editor").value = SAMPLE_SPECS.find((sample) => sample.id === state.sampleId).yaml;
  renderSampleChips();
  bindEvents();
  reloadSpec();
  const wantsTraffic = location.hash.replace("#", "") === "traffic";
  if (wantsTraffic) {
    setView("traffic", { updateHash: false });
    primeTraffic();
  } else {
    primePlayground();
  }
}

init();
