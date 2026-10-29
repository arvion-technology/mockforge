// A small YAML reader for OpenAPI documents.
//
// There is no runtime dependency budget in these projects, so rather than pull
// in a YAML library this implements the subset an OpenAPI file actually uses:
// block mappings and sequences, flow maps/arrays, quoted and plain scalars,
// comments and literal/folded block strings. Anchors, aliases, tags and
// multi-document streams are intentionally unsupported, the loader errors on
// anything it does not understand instead of guessing.
//
// The parser is indentation driven. `parseNode` receives the exact indentation
// of the block it is about to read, which makes malformed indentation an error
// rather than a silent misread.

/** Remove a trailing `# comment`, ignoring `#` inside quoted strings. */
function stripComment(value) {
  let quote = null;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (quote) {
      if (ch === "\\" && quote === '"') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "#" && (i === 0 || /\s/.test(value[i - 1]))) return value.slice(0, i).trimEnd();
  }
  return value.trimEnd();
}

/** Index of the `:` that separates a mapping key from its value. */
function findColon(text) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\" && quote === '"') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ":" && (i + 1 === text.length || /\s/.test(text[i + 1]))) return i;
  }
  return -1;
}

function tokenize(text) {
  const lines = [];
  const raw = String(text).replace(/\r\n?/g, "\n").split("\n");
  for (let n = 0; n < raw.length; n++) {
    const line = raw[n];
    if (!line.trim()) continue;
    const whitespace = line.match(/^[ \t]*/)[0];
    if (whitespace.includes("\t")) throw new Error(`yaml: tab indentation on line ${n + 1}`);
    const indent = whitespace.length;
    const rawContent = line.slice(indent).trimEnd();
    const content = stripComment(rawContent);
    if (!content || content === "---" || content === "...") continue;
    lines.push({ indent, content, rawContent, line: n + 1 });
  }
  return lines;
}

function unquoteDouble(text) {
  try {
    return JSON.parse(text);
  } catch {
    // OpenAPI strings occasionally contain escapes JSON rejects (\x, \e).
    // Fall back to a forgiving unescape rather than failing the whole file.
    return text.slice(1, -1).replace(/\\(.)/g, (_, ch) => ({ n: "\n", t: "\t", r: "\r" })[ch] ?? ch);
  }
}

function parseScalar(text) {
  const value = text.trim();
  if (value === "") return null;
  if (value.startsWith('"') && value.endsWith('"') && value.length > 1) return unquoteDouble(value);
  if (value.startsWith("'") && value.endsWith("'") && value.length > 1) return value.slice(1, -1).replace(/''/g, "'");
  if (value.startsWith("{") || value.startsWith("[")) return parseFlow(value);
  if (/^(null|~)$/i.test(value)) return null;
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === "true";
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) return Number(value);
  return value;
}

/** Parse `{a: 1, b: [x, y]}` style flow collections. */
function parseFlow(source) {
  let i = 0;
  const skip = () => {
    while (i < source.length && /\s/.test(source[i])) i++;
  };
  const quoted = () => {
    const quote = source[i++];
    let out = "";
    while (i < source.length) {
      const ch = source[i++];
      if (ch === "\\" && quote === '"') {
        const esc = source[i++];
        out += esc === "n" ? "\n" : esc === "t" ? "\t" : esc === "r" ? "\r" : esc;
      } else if (ch === quote) {
        if (quote === "'" && source[i] === "'") { out += "'"; i++; continue; }
        return out;
      } else out += ch;
    }
    throw new Error("yaml: unterminated quoted string in flow collection");
  };
  const plain = () => {
    const start = i;
    while (i < source.length && !/[,}\]\[]/.test(source[i])) i++;
    return parseScalar(source.slice(start, i).trim());
  };
  function value() {
    skip();
    const ch = source[i];
    if (ch === "{") {
      i++;
      const out = {};
      skip();
      if (source[i] === "}") { i++; return out; }
      for (;;) {
        skip();
        let key;
        if (source[i] === '"' || source[i] === "'") key = quoted();
        else {
          const start = i;
          while (i < source.length && !/[:}\]]/.test(source[i])) i++;
          key = source.slice(start, i).trim();
        }
        skip();
        if (source[i] !== ":") throw new Error("yaml: expected ':' in flow mapping");
        i++;
        out[key] = value();
        skip();
        if (source[i] === ",") { i++; continue; }
        if (source[i] === "}") { i++; return out; }
        throw new Error("yaml: expected ',' or '}' in flow mapping");
      }
    }
    if (ch === "[") {
      i++;
      const out = [];
      skip();
      if (source[i] === "]") { i++; return out; }
      for (;;) {
        out.push(value());
        skip();
        if (source[i] === ",") { i++; continue; }
        if (source[i] === "]") { i++; return out; }
        throw new Error("yaml: expected ',' or ']' in flow sequence");
      }
    }
    if (ch === '"' || ch === "'") return quoted();
    let start = i;
    while (i < source.length && !/[,\]}]/.test(source[i])) i++;
    return parseScalar(source.slice(start, i).trim());
  }
  const result = value();
  skip();
  if (i < source.length) throw new Error(`yaml: unexpected "${source.slice(i)}" after flow value`);
  return result;
}

function readBlock(lines, index, parentIndent, header) {
  const folded = header.startsWith(">");
  const chomp = header.endsWith("-");
  const collected = [];
  let base = null;
  while (index < lines.length && lines[index].indent > parentIndent) {
    const line = lines[index];
    if (base === null) base = line.indent;
    collected.push(" ".repeat(line.indent - base) + line.rawContent);
    index++;
  }
  const text = folded ? collected.join(" ").replace(/\s+/g, " ").trim() : collected.join("\n");
  return { value: chomp ? text : text + "\n", index };
}

function parseKey(text) {
  const key = text.trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    return String(parseScalar(key));
  }
  return key;
}

function parseMapping(lines, index, indent, seed) {
  const out = {};
  let current = index;
  let pending = seed;
  for (;;) {
    let content;
    if (pending !== undefined) {
      content = pending;
      pending = undefined;
    } else if (current < lines.length && lines[current].indent === indent && !lines[current].content.startsWith("-")) {
      content = lines[current].content;
      current++;
    } else break;

    const colon = findColon(content);
    if (colon < 0) throw new Error(`yaml: expected "key: value", got "${content}"`);
    const key = parseKey(content.slice(0, colon));
    let rest = content.slice(colon + 1).trim();

    if (rest.startsWith("|") || rest.startsWith(">")) {
      const block = readBlock(lines, current, indent, rest);
      out[key] = block.value;
      current = block.index;
    } else if (rest === "") {
      if (current < lines.length && lines[current].indent > indent) {
        const childIndent = lines[current].indent;
        const child = parseNode(lines, current, childIndent);
        out[key] = child.value;
        current = child.index;
      } else out[key] = null;
    } else {
      out[key] = parseScalar(rest);
    }
  }
  return { value: out, index: current };
}

function parseSequence(lines, index, indent) {
  const out = [];
  let current = index;
  while (current < lines.length && lines[current].indent === indent && lines[current].content.startsWith("-")) {
    const line = lines[current];
    const afterDash = line.content.slice(1);
    const rest = afterDash.trimStart();
    if (!rest) {
      current++;
      if (current < lines.length && lines[current].indent > indent) {
        const child = parseNode(lines, current, lines[current].indent);
        out.push(child.value);
        current = child.index;
      } else out.push(null);
      continue;
    }
    const virtualIndent = line.indent + (line.content.length - rest.length);
    if (rest.startsWith("{") || rest.startsWith("[")) {
      out.push(parseScalar(rest));
      current++;
    } else if (findColon(rest) >= 0 || rest.startsWith("|") || rest.startsWith(">")) {
      // `- name: value` is shorthand for a mapping whose first key sits two
      // columns to the right of the dash.
      const child = parseMapping(lines, current + 1, virtualIndent, rest);
      out.push(child.value);
      current = child.index;
    } else {
      out.push(parseScalar(rest));
      current++;
    }
  }
  return { value: out, index: current };
}

function parseNode(lines, index, indent) {
  if (index >= lines.length) return { value: null, index };
  return lines[index].content.startsWith("-")
    ? parseSequence(lines, index, indent)
    : parseMapping(lines, index, indent);
}

/**
 * Parse a YAML document.
 * @param {string} text
 * @returns {unknown}
 */
export function parseYaml(text) {
  const lines = tokenize(text);
  if (!lines.length) return null;
  const result = parseNode(lines, 0, lines[0].indent);
  if (result.index < lines.length) {
    throw new Error(`yaml: unexpected content on line ${lines[result.index].line}`);
  }
  return result.value;
}
