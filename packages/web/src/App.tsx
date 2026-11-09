import { useEffect, useMemo, useRef, useState } from "react";
import cytoscape, { type Core, type ElementDefinition } from "cytoscape";

type FileNode = { id: string; path: string; type: string; label: string };
type Edge = { from: string; to: string; kind: string; line: number; confidence: string };
type Impact = { nodeId: string; depth: number; path: Array<{ from: string; to: string; kind: string; line: number; confidence: string }>; confidence: string };
type GraphResponse = { nodes: FileNode[]; edges: Edge[]; warnings: string[] };
type ImpactResponse = { impacted: Impact[]; dependencies: Impact[] };
type Direction = "impacted" | "dependencies" | "both";
const colors: Record<string, string> = { html: "#f97316", css: "#38bdf8", js: "#facc15", json: "#a78bfa", asset: "#94a3b8", api: "#fb7185" };
const typeNames: Record<string, string> = { html: "HTML", css: "CSS", js: "JS / TS", json: "JSON", asset: "Asset", api: "API" };
const relationNames: Record<string, string> = { "links-stylesheet": "loads stylesheet", "loads-script": "loads script", imports: "imports", "references-asset": "references asset", "calls-api": "calls API" };

export default function App() {
  const container = useRef<HTMLDivElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const cy = useRef<Core | null>(null);
  const [graph, setGraph] = useState<GraphResponse>();
  const [impact, setImpact] = useState<ImpactResponse>({ impacted: [], dependencies: [] });
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState<Direction>("impacted");
  const [error, setError] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [confidenceFilter, setConfidenceFilter] = useState("all");
  const [theme, setTheme] = useState<"dark" | "light">("light");
  const [uploading, setUploading] = useState(false);
  const [scanMessage, setScanMessage] = useState("");

  useEffect(() => { folderInput.current?.setAttribute("webkitdirectory", ""); }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/graph").then(async (response) => { if (!response.ok) throw new Error("Could not load graph. Start the API server and refresh."); return response.json() as Promise<GraphResponse>; })
      .then((result) => { if (!cancelled) setGraph(result); }).catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { cancelled = true; };
  }, []);

  const visible = useMemo(() => {
    const ids = new Set<string>();
    if (direction !== "dependencies") impact.impacted.forEach((item) => ids.add(item.nodeId));
    if (direction !== "impacted") impact.dependencies.forEach((item) => ids.add(item.nodeId));
    return ids;
  }, [direction, impact]);

  useEffect(() => {
    if (!graph || !container.current) return;
    const regular = graph.nodes.filter((node) => !node.id.startsWith("api:") && !node.id.startsWith("unresolved:"));
    const folders = [...new Set(regular.map((node) => `folder:${node.path.includes("/") ? node.path.slice(0, node.path.lastIndexOf("/")) : "root"}`))];
    const elements: ElementDefinition[] = [
      ...folders.map((id) => ({ data: { id, label: id.slice(7), isFolder: true } })),
      ...graph.nodes.map((node) => ({ data: { id: node.id, ...(regular.includes(node) ? { parent: `folder:${node.path.includes("/") ? node.path.slice(0, node.path.lastIndexOf("/")) : "root"}` } : {}), label: node.label, type: node.type, path: node.path, color: colors[node.type] ?? colors.asset } })),
      ...graph.edges.map((edge, index) => ({ data: { id: `e${index}`, source: edge.from, target: edge.to, kind: edge.kind, line: edge.line, confidence: edge.confidence } })),
    ];
    cy.current?.destroy();
    cy.current = cytoscape({ container: container.current, elements, style: [
      { selector: "node", style: { label: "data(label)", "background-color": "data(color)", color: theme === "dark" ? "#e2e8f0" : "#182234", "font-size": 10, "text-valign": "bottom", "text-margin-y": 6, width: 24, height: 24, "text-outline-color": theme === "dark" ? "#0b1220" : "#fff", "text-outline-width": 2, "overlay-opacity": 0 } },
      { selector: "$node[?isFolder]", style: { "background-color": theme === "dark" ? "#172234" : "#e6edf5", "background-opacity": 0.45, "border-color": theme === "dark" ? "#526176" : "#9aabc0", "border-width": 1, "border-style": "dashed", label: "data(label)", color: theme === "dark" ? "#a7b6c9" : "#526176", "text-valign": "top", "text-halign": "center", padding: "16px", shape: "round-rectangle" } },
      { selector: "edge", style: { width: 1, "line-color": "#64748b", "target-arrow-color": "#64748b", "target-arrow-shape": "triangle", "curve-style": "bezier", opacity: 0.5, label: "data(kind)", "font-size": 7, color: theme === "dark" ? "#94a3b8" : "#59677a" } },
      { selector: ".dim", style: { opacity: 0.12 } },
      { selector: ".depth1", style: { "background-color": "#ef4444", "border-width": 4, "border-color": "#fecaca", opacity: 1 } },
      { selector: ".depth2", style: { "background-color": "#f97316", "border-width": 3, "border-color": "#fed7aa", opacity: 1 } },
      { selector: ".depth3", style: { "background-color": "#eab308", "border-width": 3, "border-color": "#fef08a", opacity: 1 } },
      { selector: ".selected", style: { "border-width": 4, "border-color": "#fff", opacity: 1 } },
      { selector: "edge.highlight", style: { "line-color": "#fb7185", "target-arrow-color": "#fb7185", width: 2, opacity: 0.95 } },
    ], layout: { name: "cose", animate: false, nodeRepulsion: 5500, idealEdgeLength: 90, padding: 36 }, minZoom: 0.15, maxZoom: 3 });
    cy.current.on("tap", "node", (event) => { if (!event.target.data("isFolder")) setSelected(String(event.target.id())); });
    return () => { cy.current?.destroy(); cy.current = null; };
  }, [graph, theme]);

  useEffect(() => {
    if (!selected) { setImpact({ impacted: [], dependencies: [] }); return; }
    let cancelled = false;
    fetch(`/api/impact?node=${encodeURIComponent(selected)}`).then(async (response) => { if (!response.ok) throw new Error(`Could not calculate impact for ${selected}`); return response.json() as Promise<ImpactResponse>; })
      .then((result) => { if (!cancelled) setImpact(result); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
    return () => { cancelled = true; };
  }, [selected]);

  useEffect(() => {
    const instance = cy.current; if (!instance) return;
    instance.elements().removeClass("dim depth1 depth2 depth3 selected highlight");
    if (!selected) return;
    instance.elements().addClass("dim"); instance.getElementById(selected).removeClass("dim").addClass("selected");
    const impacted = direction === "dependencies" ? [] : impact.impacted;
    const dependencies = direction === "impacted" ? [] : impact.dependencies;
    for (const item of [...impacted, ...dependencies]) { const node = instance.getElementById(item.nodeId); node.removeClass("dim").addClass(item.depth === 1 ? "depth1" : item.depth === 2 ? "depth2" : "depth3"); }
    instance.edges().forEach((edge) => { const source = String(edge.data("source")); const target = String(edge.data("target")); if ((target === selected && visible.has(source)) || (source === selected && visible.has(target))) edge.addClass("highlight"); });
  }, [selected, impact, direction, visible]);

  const filteredNodes = (graph?.nodes ?? []).filter((node) => (typeFilter === "all" || node.type === typeFilter) && (confidenceFilter === "all" || graph?.edges.some((edge) => (edge.from === node.id || edge.to === node.id) && edge.confidence === confidenceFilter)));
  const matches = filteredNodes.filter((node) => node.path.toLowerCase().includes(query.toLowerCase())).slice(0, 8);
  const searchOpen = query.trim().length > 0;
  const impactedNodes = filteredNodes.filter((node) => impact.impacted.some((item) => item.nodeId === node.id));
  const dependencyNodes = filteredNodes.filter((node) => impact.dependencies.some((item) => item.nodeId === node.id));
  async function scanFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    setUploading(true); setScanMessage(""); setError(""); setSelected("");
    try {
      const files = await Promise.all(Array.from(fileList).map(async (file) => ({
        path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
        content: await file.text(),
      })));
      const response = await fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files }) });
      const result = await response.json() as GraphResponse & { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not scan this upload.");
      setGraph(result); setScanMessage(`Scanned ${result.nodes.length} files`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setUploading(false); }
  }
  return <main className={`app-shell ${theme}`}>
    <header className="topbar"><div><span className="eyebrow">SEE WHAT A CHANGE CAN AFFECT</span><h1>Project Impact</h1><p className="product-summary">Scan a web project to map file connections and see what may be affected before you edit.</p></div><div className="status"><span className="status-dot" />{scanMessage || (graph ? `${graph.nodes.length} files in this project` : "Loading project…")}<button className="upload-button" disabled={uploading} onClick={() => folderInput.current?.click()}>{uploading ? "Scanning project…" : graph ? "Choose a project" : "Choose a project folder"}</button><button className="theme-toggle" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? "Light theme" : "Dark theme"}</button><input ref={folderInput} className="hidden-input" type="file" multiple onChange={(event) => { void scanFiles(event.target.files); event.target.value = ""; }} /><input ref={filesInput} className="hidden-input" type="file" multiple onChange={(event) => { void scanFiles(event.target.files); event.target.value = ""; }} /></div></header>
    <div className="workspace"><section className="graph-panel"><div className="toolbar">
      <label className="search"><span>Find a file</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Type a file name…" aria-label="Search project files" />{searchOpen && <div className="search-results">{matches.length ? matches.map((node) => <button key={node.id} onClick={() => { setSelected(node.id); setQuery(""); }}>{node.path}</button>) : <p>No files match “{query}”. Try a shorter name.</p>}</div>}</label>
      <div className="view-control"><span>Show:</span><div className="segmented">{(["impacted", "dependencies", "both"] as Direction[]).map((value) => <button key={value} className={direction === value ? "active" : ""} onClick={() => setDirection(value)}>{value === "impacted" ? "Affected" : value === "dependencies" ? "Uses" : "Both"}</button>)}</div></div>
      <details className="filters"><summary>More filters</summary><label>File type<select aria-label="Filter file type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">All file types</option>{[...new Set((graph?.nodes ?? []).map((node) => node.type))].map((type) => <option key={type}>{type}</option>)}</select></label><label>Match strength<select aria-label="Filter confidence" value={confidenceFilter} onChange={(event) => setConfidenceFilter(event.target.value)}><option value="all">All matches</option><option value="certain">Strong matches</option><option value="possible">Possible matches</option></select></label></details>
    </div><div className="graph-stage" ref={container}>{!graph && !error && <div className="loading">Building the project map…</div>}{graph?.nodes.length === 0 && <div className="loading"><div><h2>No project loaded yet</h2><p>Choose a project folder to see how its files connect.</p><button className="upload-button" onClick={() => folderInput.current?.click()}>Choose project folder</button></div></div>}{graph && graph.nodes.length > 0 && !selected && <div className="graph-hint">Choose a file to see what may be affected by editing it. Lines show how files connect.</div>}{uploading && <div className="upload-overlay" role="status" aria-live="polite"><div className="upload-card"><span className="upload-spinner" aria-hidden="true" /><div><strong>Scanning your folder</strong><p>Reading files and building the project map�</p></div></div></div>}</div><div className="legend"><span><i className="legend-impact" />May be affected</span><span><i className="legend-source" />Selected file</span><span>Each dot is a file. Lines show references. Click to explore.</span></div></section>    <aside className="sidebar"><div className="sidebar-head"><span className="eyebrow">SELECTED FILE</span><h2>{selected ? graph?.nodes.find((node) => node.id === selected)?.path : graph?.nodes.length ? "Choose a file to start" : "Your results appear here"}</h2><p>{selected ? "These files may be affected if you change this file. Follow the connections to see why." : graph?.nodes.length ? "Choose a file in the map or search above to see which files may depend on it." : "Choose a project folder to build its file map."}</p></div>
      {selected && direction !== "dependencies" && <ImpactGroup title="FILES THIS MAY AFFECT" nodes={impactedNodes} results={impact.impacted} selected={selected} setSelected={setSelected} graph={graph} />}
      {selected && direction !== "impacted" && <ImpactGroup title="FILES THIS USES" nodes={dependencyNodes} results={impact.dependencies} selected={selected} setSelected={setSelected} graph={graph} />}
      {selected && !visible.size && <div className="empty-state"><strong>No connected files found</strong><p>Try another file or check the scan notes.</p></div>}<div className="sidebar-foot"><strong>What the map looks for</strong><p>HTML loading CSS or JavaScript, files importing other files, styles referencing assets, and JavaScript calling API endpoints. These are clues to review, not a guarantee that a change will break something.</p></div>
    </aside></div>
  </main>;
}

function ImpactGroup({ title, nodes, results, selected, setSelected, graph }: { title: string; nodes: FileNode[]; results: Impact[]; selected: string; setSelected: (id: string) => void; graph: GraphResponse | undefined }) {
  const maxDepth = Math.max(0, ...results.map((item) => item.depth)); if (!nodes.length) return null;
  return <section className="impact-group"><h3>{title}<span>{nodes.length} {nodes.length === 1 ? "file" : "files"}</span></h3>{Array.from({ length: maxDepth }, (_, index) => index + 1).map((depth) => {
    const group = nodes.filter((node) => results.find((item) => item.nodeId === node.id)?.depth === depth); if (!group.length) return null;
    return <div className="depth-group" key={depth}><div className="depth-label"><i className={`depth-dot d${Math.min(depth, 3)}`} />{depth === 1 ? "DIRECTLY CONNECTED" : `${depth} STEPS AWAY`}</div>{group.map((node) => {
      const result = results.find((item) => item.nodeId === node.id); const edge = result?.path.at(-1); const file = graph?.nodes.find((item) => item.id === (edge?.from === node.id ? edge?.to : edge?.from));
      return <button className={`file-row ${node.id === selected ? "current" : ""}`} key={node.id} onClick={() => setSelected(node.id)} title={edge ? `${relationNames[edge.kind] ?? edge.kind} ${file?.path ?? ""} at line ${edge.line} (${edge.confidence})` : node.path}><span className="file-type" style={{ color: colors[node.type] ?? colors.asset }}>{typeNames[node.type] ?? node.type}</span><span className="file-path">{node.path}<small>{edge ? `${relationNames[edge.kind] ?? edge.kind} ${file?.path ?? ""} · line ${edge.line} · ${edge.confidence === "certain" ? "strong match" : "possible match"}` : ""}</small></span><span className="row-arrow">↗</span></button>;
    })}</div>;
  })}</section>;
}
