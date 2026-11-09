import { promises as fs } from "node:fs";
import * as fsSync from "node:fs";
import path from "node:path";
import type { Edge, Graph, Node, Reference } from "./model.js";
import { parseJavaScript, validateJavaScript } from "./parsers/javascript.js";
import { parseHtml } from "./parsers/html.js";
import { parseCss, validateCss } from "./parsers/css.js";
import { scanProject } from "./scanner.js";

const JS_EXTENSIONS = [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"];
const INDEX_FILES = ["index.ts", "index.tsx", "index.js", "index.jsx", "index.mts", "index.cts", "index.mjs", "index.cjs"];
const RESOLVABLE_EXTENSIONS = [...JS_EXTENSIONS, ".html", ".htm", ".json", ".css"];

function isExternal(specifier: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/|#|data:)/i.test(specifier);
}

function parseTsconfigPaths(text: string): { baseUrl: string; aliases: Array<{ pattern: string; targets: string[] }> } {
  try {
    const config = JSON.parse(text.replace(/^\uFEFF/, "").replace(/^\s*\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "")) as {
      compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
    };
    return {
      baseUrl: config.compilerOptions?.baseUrl ?? ".",
      aliases: Object.entries(config.compilerOptions?.paths ?? {}).map(([pattern, targets]) => ({ pattern, targets })),
    };
  } catch { return { baseUrl: ".", aliases: [] }; }
}

function resolveReference(root: string, fromPath: string, specifier: string, known: Set<string>, aliases: Array<{ pattern: string; targets: string[] }>, baseUrl: string): string | undefined {
  const candidates: string[] = [];
  if (specifier.startsWith(".")) candidates.push(path.resolve(root, path.dirname(fromPath), specifier));
  else if (specifier.startsWith("/")) candidates.push(path.resolve(root, `.${specifier}`));
  else {
    for (const alias of aliases) {
      const star = alias.pattern.indexOf("*");
      const prefix = star < 0 ? alias.pattern : alias.pattern.slice(0, star);
      const suffix = star < 0 ? "" : alias.pattern.slice(star + 1);
      if (specifier.startsWith(prefix) && specifier.endsWith(suffix) && specifier.length >= prefix.length + suffix.length) {
        const middle = specifier.slice(prefix.length, suffix ? -suffix.length : undefined);
        for (const target of alias.targets) candidates.push(path.resolve(root, baseUrl, target.replace("*", middle)));
      }
    }
    if (!candidates.length && baseUrl !== ".") candidates.push(path.resolve(root, baseUrl, specifier));
    if (!candidates.length) {
      // Resolve monorepo workspace packages through their declared source entry.
      const workspace = specifier.match(/^(@[^/]+\/[^/]+|[^/]+)(?:\/(.*))?$/);
      if (workspace) {
        const packagesRoot = path.join(root, "packages");
        try {
          for (const directory of fsSync.readdirSync(packagesRoot)) {
            const packageRoot = path.join(packagesRoot, directory);
            const manifest = JSON.parse(fsSync.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
            if (manifest.name !== workspace[1]) continue;
            const entry = workspace[2] ?? manifest.exports?.["."] ?? manifest.main ?? "index.js";
            candidates.push(path.resolve(root, "packages", directory, entry));
          }
        } catch { /* no workspace package */ }
      }
      if (!candidates.length) return undefined;
    }
  }
  for (const candidate of candidates) {
    const relative = path.relative(root, candidate).split(path.sep).join("/");
    if (relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) continue;
    const extension = path.posix.extname(relative);
    // TS projects commonly write ESM imports with a .js suffix while the
    // source on disk is .ts/.tsx; try the corresponding source extensions.
    const stem = extension === ".js" ? relative.slice(0, -3) : relative;
    const options = [relative, ...RESOLVABLE_EXTENSIONS.map((ext) => relative + ext), ...(extension === ".js" ? [".ts", ".tsx", ".mts", ".cts"].map((ext) => stem + ext) : []), ...INDEX_FILES.map((name) => path.posix.join(relative, name))];
    for (const option of options) if (known.has(option)) return option;
  }
  return undefined;
}

export interface BuildGraphOptions { onWarning?: (message: string) => void; concurrency?: number }

export async function buildGraph(projectPath: string, options: BuildGraphOptions = {}): Promise<Graph> {
  const scan = await scanProject(projectPath);
  const nodes = new Map<string, Node>(scan.files.map(({ node }) => [node.id, node]));
  const known = new Set(nodes.keys());
  const warnings = [...scan.warnings];
  for (const warning of warnings) options.onWarning?.(warning);
  let { aliases, baseUrl } = { aliases: [] as Array<{ pattern: string; targets: string[] }>, baseUrl: "." };
  try { ({ aliases, baseUrl } = parseTsconfigPaths(await fs.readFile(path.join(scan.root, "tsconfig.json"), "utf8"))); } catch { /* optional */ }
  const edges: Edge[] = [];
  const limit = Math.max(1, options.concurrency ?? 8);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < scan.files.length) {
      const file = scan.files[cursor++];
      if (!file || (file.node.type !== "js" && file.node.type !== "html" && file.node.type !== "css")) continue;
      let source: string;
      try { source = await fs.readFile(file.absolutePath, "utf8"); }
      catch (error) { const warning = `Could not read ${file.node.path}: ${String(error)}`; warnings.push(warning); options.onWarning?.(warning); continue; }
      let references: Reference[];
      try {
        if (file.node.type === "js") validateJavaScript(source, file.node.path);
        if (file.node.type === "css") validateCss(source);
        references = file.node.type === "js" ? parseJavaScript(source, file.node.path) : file.node.type === "css" ? parseCss(source) : parseHtml(source);
      } catch (error) { const warning = `Could not parse ${file.node.path}: ${String(error)}`; warnings.push(warning); options.onWarning?.(warning); continue; }
      for (const reference of references) {
        if (!reference.specifier) continue;
        if (reference.kind === "calls-api") {
          const id = `api:${reference.specifier}`;
          if (!nodes.has(id)) nodes.set(id, { id, path: reference.specifier, type: "api", label: reference.specifier });
          edges.push({ from: file.node.id, to: id, kind: "calls-api", line: reference.line, confidence: reference.confidence });
          continue;
        }
        if (isExternal(reference.specifier)) continue;
        const hasAlias = aliases.some(({ pattern }) => reference.specifier.startsWith(pattern.split("*")[0] ?? pattern));
        // Bare imports are packages supplied by the runtime/package manager.
        // Keep unresolved diagnostics for project paths and configured aliases.
        if (!reference.specifier.startsWith(".") && !reference.specifier.startsWith("/") && !hasAlias && !reference.specifier.startsWith("@")) continue;
        const target = resolveReference(scan.root, file.node.path, reference.specifier, known, aliases, baseUrl);
        if (!target) {
          const warning = `Unresolved reference ${reference.specifier} in ${file.node.path}:${reference.line}`;
          warnings.push(warning); options.onWarning?.(warning);
          continue;
        }
        edges.push({ from: file.node.id, to: target, kind: reference.kind, line: reference.line, confidence: reference.confidence });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, scan.files.length) }, () => worker()));
  edges.sort((a, b) => a.from.localeCompare(b.from) || a.line - b.line || a.to.localeCompare(b.to));
  const forward = new Map<string, Edge[]>();
  const reverse = new Map<string, Edge[]>();
  for (const edge of edges) {
    const outgoing = forward.get(edge.from) ?? []; outgoing.push(edge); forward.set(edge.from, outgoing);
    const incoming = reverse.get(edge.to) ?? []; incoming.push(edge); reverse.set(edge.to, incoming);
  }
  return { nodes, edges, forward, reverse };
}
