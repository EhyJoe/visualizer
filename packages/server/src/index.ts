import express from "express";
import path from "node:path";
import { buildGraph, getDependencies, getImpact, type Graph } from "@impact-viz/core";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import os from "node:os";

const app = express();
app.use(express.json({ limit: "32mb" }));
const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
const port = Number(process.env.PORT ?? 4174);
let graph: Graph | undefined;
let projectRoot = "";
let warnings: string[] = [];

function serializeGraph(value: Graph) {
  return {
    nodes: [...value.nodes.values()],
    edges: value.edges,
  };
}

app.get("/api/health", (_request, response) => response.json({ ok: true, projectRoot }));
app.use(express.static(webDist));
app.post("/api/scan", async (request, response) => {
  const files = request.body?.files;
  if (!Array.isArray(files) || files.length === 0 || files.length > 500) {
    response.status(400).json({ error: "Choose between 1 and 500 text files to scan." }); return;
  }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "impact-viz-upload-"));
  try {
    for (const file of files) {
      if (typeof file?.path !== "string" || typeof file?.content !== "string") throw new Error("Invalid uploaded file.");
      const relative = file.path.replace(/\\/g, "/");
      if (!relative || relative.startsWith("/") || relative.split("/").some((part: string) => !part || part === "." || part === "..") || path.isAbsolute(relative)) throw new Error("Unsafe file path in upload.");
      if (Buffer.byteLength(file.content, "utf8") > 2_000_000) throw new Error(`${relative} is larger than 2 MB.`);
      const target = path.resolve(root, relative);
      if (!target.startsWith(`${root}${path.sep}`)) throw new Error("Unsafe file path in upload.");
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.content, "utf8");
    }
    const uploadWarnings: string[] = [];
    const nextGraph = await buildGraph(root, { onWarning: (warning) => uploadWarnings.push(warning) });
    graph = nextGraph; projectRoot = "Uploaded project"; warnings = uploadWarnings;
    response.json({ ...serializeGraph(nextGraph), warnings });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Could not scan upload." });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
app.get("/api/graph", (_request, response) => {
  if (!graph) { response.status(503).json({ error: "Graph is not ready" }); return; }
  response.json({ ...serializeGraph(graph), warnings });
});
app.get("/api/impact/:nodeId", (request, response) => {
  if (!graph) { response.status(503).json({ error: "Graph is not ready" }); return; }
  const nodeId = request.params.nodeId;
  if (!graph.nodes.has(nodeId)) { response.status(404).json({ error: `Unknown file: ${nodeId}` }); return; }
  response.json({ impacted: getImpact(graph, nodeId), dependencies: getDependencies(graph, nodeId) });
});
app.get("/api/impact", (request, response) => {
  if (!graph) { response.status(503).json({ error: "Graph is not ready" }); return; }
  const nodeId = String(request.query.node ?? "");
  if (!graph.nodes.has(nodeId)) { response.status(404).json({ error: `Unknown file: ${nodeId}` }); return; }
  response.json({ impacted: getImpact(graph, nodeId), dependencies: getDependencies(graph, nodeId) });
});
app.get(/.*/, (_request, response) => response.sendFile(path.join(webDist, "index.html")));

async function main(): Promise<void> {
  app.listen(port, "0.0.0.0", () =>
    console.log(`Impact Visualizer API listening on port ${port}`)
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
