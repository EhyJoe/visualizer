#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraph, getImpact, type Graph } from "@impact-viz/core";

function openBrowser(url: string): void {
  const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" }); child.unref();
}
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => { const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); if (!address || typeof address === "string") { reject(new Error("Unable to allocate port")); return; } server.close(() => resolve(address.port)); }); });
}
function explain(graph: Graph, nodeId: string): void {
  if (!graph.nodes.has(nodeId)) { console.error(`Changed file not found in graph: ${nodeId}`); process.exitCode = 1; return; }
  const results = getImpact(graph, nodeId);
  if (!results.length) { console.log(`No impacted files for ${nodeId}`); return; }
  for (const item of results) {
    const step = item.path.at(-1); const source = step ? graph.nodes.get(step.from)?.path : "";
    console.log(`${"  ".repeat(Math.max(0, item.depth - 1))}${graph.nodes.get(item.nodeId)?.path ?? item.nodeId} (depth ${item.depth}, ${item.confidence}) — ${step?.kind ?? "reference"} ${source}:${step?.line ?? 0}`);
  }
}
async function main(): Promise<void> {
  const args = process.argv.slice(2); const project = path.resolve(args.find((value) => !value.startsWith("--")) ?? process.cwd());
  const graph = await buildGraph(project, { onWarning: (message) => console.warn(`Warning: ${message}`) });
  if (args.includes("--changed")) { const index = args.indexOf("--changed"); const changed = args[index + 1]; if (!changed) throw new Error("--changed requires a file path"); explain(graph, changed.split(path.sep).join("/")); return; }
  if (args.includes("--git-diff")) {
    const changed = execFileSync("git", ["diff", "--name-only", "HEAD"], { cwd: project, encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
    const all = new Map<string, ReturnType<typeof getImpact>[number]>();
    for (const file of changed) for (const impact of getImpact(graph, file.split(path.sep).join("/"))) {
      const prior = all.get(impact.nodeId); if (!prior || impact.depth < prior.depth) all.set(impact.nodeId, impact);
    }
    console.log(`Combined impact for ${changed.length} changed files:`);
    for (const [id, item] of all) console.log(`${graph.nodes.get(id)?.path ?? id} (depth ${item.depth}, ${item.confidence})`);
    return;
  }
  const port = await freePort(); process.env.PORT = String(port);
  const serverFile = fileURLToPath(new URL("./index.ts", import.meta.url));
  const child = spawn(process.execPath, ["--import", "tsx", serverFile, project], { stdio: "inherit", env: { ...process.env, PORT: String(port) } });
  const url = `http://127.0.0.1:${port}`; console.log(`Starting Impact Visualizer for ${project} at ${url}`); openBrowser(url);
  child.on("exit", (code) => { process.exitCode = code ?? 0; });
  process.on("SIGINT", () => child.kill("SIGINT"));
}
void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
