import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { scanProject } from "../src/scanner.js";

describe("scanProject", () => {
  it("classifies web project files, respects .gitignore, and skips generated directories", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "impact-viz-scan-"));
    try {
      await mkdir(path.join(root, "src"), { recursive: true });
      for (const directory of ["node_modules", "dist", "build", ".git"]) {
        await mkdir(path.join(root, directory));
        await writeFile(path.join(root, directory, "hidden.js"), "export {};");
      }
      await writeFile(path.join(root, ".gitignore"), "ignored.json\nprivate/\n");
      await mkdir(path.join(root, "private"));
      const fixtures: Record<string, string> = {
        "index.html": "",
        "src/site.css": "",
        "src/main.tsx": "",
        "src/data.json": "{}",
        "src/logo.svg": "",
        "ignored.json": "{}",
        "private/secret.js": "",
      };
      for (const [file, contents] of Object.entries(fixtures)) {
        await writeFile(path.join(root, file), contents);
      }

      const result = await scanProject(root);
      expect(result.files.map(({ node }) => [node.path, node.type])).toEqual([
        [".gitignore", "asset"],
        ["index.html", "html"],
        ["src/data.json", "json"],
        ["src/logo.svg", "asset"],
        ["src/main.tsx", "js"],
        ["src/site.css", "css"],
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
