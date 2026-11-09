import { describe, expect, it } from "vitest";
import { buildGraph } from "../src/graph-builder.js";
import { getDependencies, getImpact } from "../src/impact.js";
import { scanProject } from "../src/scanner.js";
import type { Edge, Graph, Node } from "../src/model.js";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function graph(edges: Edge[]): Graph {
  const nodes = new Map<string, Node>(["a.js", "b.js", "c.js", "missing.js"].map((id) => [id, { id, path: id, type: "js", label: id }]));
  const forward = new Map<string, Edge[]>(), reverse = new Map<string, Edge[]>();
  for (const edge of edges) { forward.set(edge.from, [...(forward.get(edge.from) ?? []), edge]); reverse.set(edge.to, [...(reverse.get(edge.to) ?? []), edge]); }
  return { nodes, edges, forward, reverse };
}

describe("impact traversal", () => {
  it("finds reverse impact and forward dependencies with explanations", () => {
    const g = graph([{ from: "a.js", to: "b.js", kind: "imports", line: 2, confidence: "certain" }, { from: "b.js", to: "c.js", kind: "imports", line: 4, confidence: "possible" }]);
    expect(getImpact(g, "c.js").map((r) => [r.nodeId, r.depth, r.confidence])).toEqual([["b.js", 1, "possible"], ["a.js", 2, "possible"]]);
    expect(getDependencies(g, "a.js").map((r) => r.nodeId)).toEqual(["b.js", "c.js"]);
  });

  it("handles circular dependencies and unknown nodes", () => {
    const g = graph([{ from: "a.js", to: "b.js", kind: "imports", line: 1, confidence: "certain" }, { from: "b.js", to: "a.js", kind: "imports", line: 1, confidence: "certain" }]);
    expect(getImpact(g, "a.js").map((result) => result.nodeId)).toEqual(["b.js"]);
    expect(getImpact(g, "unknown")).toEqual([]);
  });

  it("builds a project graph, resolves index files, skips missing references and .gitignored files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "impact-viz-"));
    try {
      await mkdir(path.join(root, "lib"), { recursive: true });
      await writeFile(path.join(root, ".gitignore"), "ignored.js\n");
      await writeFile(path.join(root, "main.js"), "import './lib';\nimport './missing.js';");
      await writeFile(path.join(root, "lib", "index.js"), "export const x = 1;");
      await writeFile(path.join(root, "ignored.js"), "export {};");
      const result = await buildGraph(root);
      expect(result.nodes.has("lib/index.js")).toBe(true);
      expect(result.nodes.has("ignored.js")).toBe(false);
      expect(result.edges.map((edge) => edge.to)).toEqual(["lib/index.js"]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("resolves HTML links, query strings, extensionless files, and tsconfig aliases", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "impact-viz-resolve-"));
    try {
      await mkdir(path.join(root, "src", "parts"), { recursive: true });
      await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } }));
      await writeFile(path.join(root, "index.html"), '<script src="./app"></script><link rel="stylesheet" href="./site.css?v=1">');
      await writeFile(path.join(root, "app.js"), 'import "@/parts";');
      await writeFile(path.join(root, "site.css"), "body {}");
      await writeFile(path.join(root, "src", "parts", "index.ts"), "export const value = 1;");
      const result = await buildGraph(root);
      expect(result.edges.map(({ from, to }) => [from, to])).toEqual([
        ["app.js", "src/parts/index.ts"], ["index.html", "app.js"], ["index.html", "site.css"],
      ]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("maps HTML to stylesheets, stylesheets to assets, and scripts to API endpoints", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "impact-viz-relationships-"));
    try {
      await mkdir(path.join(root, "assets"), { recursive: true });
      await writeFile(path.join(root, "index.html"), '<link rel="stylesheet" href="./site.css"><script src="./main.js"></script>');
      await writeFile(path.join(root, "site.css"), "@import './theme.css?mode=dark';\n.logo { background: url('./assets/logo.svg#mark'); }");
      await writeFile(path.join(root, "theme.css"), "body { color: black; }");
      await writeFile(path.join(root, "assets", "logo.svg"), "<svg />");
      await writeFile(path.join(root, "main.js"), "fetch('/api/items');");
      const result = await buildGraph(root);
      expect(result.edges.map(({ from, to, kind }) => [from, to, kind])).toEqual([
        ["index.html", "main.js", "loads-script"],
        ["index.html", "site.css", "links-stylesheet"],
        ["main.js", "api:/api/items", "calls-api"],
        ["site.css", "theme.css", "references-asset"],
        ["site.css", "assets/logo.svg", "references-asset"],
      ]);
      expect(getImpact(result, "assets/logo.svg").map(({ nodeId }) => nodeId)).toEqual(["site.css", "index.html"]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("returns warnings for invalid project paths and malformed source without stopping the scan", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "impact-viz-warn-"));
    try {
      await writeFile(path.join(root, "bad.js"), "const = ;");
      const warnings: string[] = [];
      const graphResult = await buildGraph(root, { onWarning: (warning) => warnings.push(warning) });
      expect(graphResult.nodes.has("bad.js")).toBe(true);
      expect(graphResult.edges).toEqual([]);
      expect(warnings.some((warning) => warning.includes("Could not parse bad.js"))).toBe(true);
      expect((await scanProject(path.join(root, "absent"))).warnings).toHaveLength(1);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
