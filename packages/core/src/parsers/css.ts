import postcss from "postcss";
import type { Reference } from "../model.js";

function localPath(value: string): string {
  return value.split(/[?#]/, 1)[0]?.trim() ?? "";
}

export function parseCss(source: string): Reference[] {
  const refs: Reference[] = [];
  try {
    const root = postcss.parse(source);
    root.walkAtRules("import", (rule) => {
      const match = rule.params.match(/^(?:url\()?['"]?([^'"\s)]+)['"]?\)?/i);
      const value = match?.[1] ? localPath(match[1]) : "";
      if (value && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#|data:)/i.test(value)) refs.push({ specifier: value, line: rule.source?.start?.line ?? 1, kind: "references-asset", confidence: "certain" });
    });
    root.walkDecls((decl) => {
      for (const match of decl.value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
        const value = localPath(match[2] ?? "");
        if (value && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#|data:)/i.test(value)) refs.push({ specifier: value, line: decl.source?.start?.line ?? 1, kind: "references-asset", confidence: "certain" });
      }
    });
  } catch { /* malformed CSS is handled by caller validation */ }
  return refs;
}

export function validateCss(source: string): void { postcss.parse(source); }
