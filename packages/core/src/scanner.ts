import { promises as fs } from "node:fs";
import path from "node:path";
import ignoreModule from "ignore";
import type { FileType, Node } from "./model.js";

const ALWAYS_SKIP = new Set(["node_modules", "dist", "build", ".git"]);
const EXTENSIONS: Record<string, FileType> = {
  ".html": "html", ".htm": "html", ".css": "css",
  ".js": "js", ".jsx": "js", ".mjs": "js", ".cjs": "js",
  ".ts": "js", ".tsx": "js", ".mts": "js", ".cts": "js",
  ".json": "json",
};

export interface ScannedFile { node: Node; absolutePath: string }
export interface ScanResult { root: string; files: ScannedFile[]; warnings: string[] }

export async function scanProject(projectPath: string): Promise<ScanResult> {
  const root = path.resolve(projectPath);
  const warnings: string[] = [];
  try {
    const rootStat = await fs.stat(root);
    if (!rootStat.isDirectory()) return { root, files: [], warnings: [`Project path is not a directory: ${root}`] };
  } catch (error) {
    return { root, files: [], warnings: [`Could not access project path ${root}: ${String(error)}`] };
  }
  const rules = ignoreModule.default();
  try { rules.add(await fs.readFile(path.join(root, ".gitignore"), "utf8")); } catch { /* optional */ }
  const files: ScannedFile[] = [];
  async function walk(directory: string): Promise<void> {
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch (error) { warnings.push(`Could not read ${directory}: ${String(error)}`); return; }
    await Promise.all(entries.map(async (entry) => {
      if (entry.isSymbolicLink()) return;
      const absolutePath = path.join(directory, entry.name);
      const relative = path.relative(root, absolutePath).split(path.sep).join("/");
      if (entry.isDirectory()) {
        if (ALWAYS_SKIP.has(entry.name) || rules.ignores(`${relative}/`)) return;
        await walk(absolutePath);
        return;
      }
      if (!entry.isFile() || rules.ignores(relative)) return;
      const extension = path.extname(entry.name).toLowerCase();
      const type = EXTENSIONS[extension] ?? "asset";
      files.push({ absolutePath, node: { id: relative, path: relative, type, label: path.basename(entry.name) } });
    }));
  }
  await walk(root);
  files.sort((a, b) => a.node.path.localeCompare(b.node.path));
  return { root, files, warnings };
}
