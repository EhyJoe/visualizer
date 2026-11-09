import { parse } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";
import type { Reference } from "../model.js";

type Element = DefaultTreeAdapterMap["element"];
function attr(element: Element, name: string): string | undefined {
  return element.attrs.find((item) => item.name.toLowerCase() === name)?.value;
}

/** Extract local script, stylesheet, image and anchor references with source lines. */
export function parseHtml(source: string): Reference[] {
  const references: Reference[] = [];
  const document = parse(source, { sourceCodeLocationInfo: true });
  function visit(node: DefaultTreeAdapterMap["node"]): void {
    if (node.nodeName === "#comment" || node.nodeName === "#text" || node.nodeName === "#documentType") return;
    if ("tagName" in node) {
      const element = node as Element;
      const tag = element.tagName.toLowerCase();
      let value: string | undefined;
      let kind: Reference["kind"] | undefined;
      if (tag === "link" && (attr(element, "rel") ?? "").toLowerCase().split(/\s+/).includes("stylesheet")) {
        value = attr(element, "href"); kind = "links-stylesheet";
      } else if (tag === "script") {
        value = attr(element, "src"); kind = "loads-script";
      } else if (tag === "img") {
        value = attr(element, "src"); kind = "references-asset";
      } else if (tag === "a") {
        value = attr(element, "href"); kind = "references-asset";
      }
      if (value && kind && !/^(?:[a-z][a-z\d+.-]*:|\/\/|\/|#|data:)/i.test(value)) {
        const localPath = value.split(/[?#]/, 1)[0] ?? "";
        if (localPath) references.push({ specifier: localPath, line: element.sourceCodeLocation?.startLine ?? 1, kind, confidence: "certain" });
      }
    }
    if ("childNodes" in node) for (const child of node.childNodes) visit(child);
    if ("content" in node && node.content) visit(node.content);
  }
  visit(document);
  return references;
}
