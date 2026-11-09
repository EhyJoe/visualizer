import { parse } from "@babel/parser";
import type { Node as BabelNode } from "@babel/types";
import type { Reference } from "../model.js";

function literal(node: BabelNode | null | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === "StringLiteral" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0]?.value.cooked ?? "";
  return undefined;
}

function template(node: BabelNode | null | undefined): { value: string; dynamic: boolean } | undefined {
  if (!node) return undefined;
  if (node.type === "TemplateLiteral") {
    const value = node.quasis.map((part) => part.value.cooked ?? "").join("${...}");
    return { value, dynamic: node.expressions.length > 0 };
  }
  const value = literal(node);
  return value === undefined ? undefined : { value, dynamic: false };
}

/** Extract module references from JS/TS/JSX/TSX. Malformed source returns an empty list. */
export function parseJavaScript(source: string, filename = "source.js"): Reference[] {
  const references: Reference[] = [];
  try {
    const ast = parse(source, {
      sourceType: "unambiguous",
      sourceFilename: filename,
      plugins: ["typescript", "jsx", "decorators-legacy", "dynamicImport", "importMeta"],
      errorRecovery: false,
    });
    const visit = (node: BabelNode): void => {
      if (node.type === "ImportDeclaration") {
        references.push({ specifier: node.source.value, line: node.loc?.start.line ?? 1, kind: "imports", confidence: "certain" });
      } else if ((node.type === "ExportAllDeclaration" || node.type === "ExportNamedDeclaration") && node.source) {
        references.push({ specifier: node.source.value, line: node.loc?.start.line ?? 1, kind: "imports", confidence: "certain" });
      } else if (node.type === "CallExpression") {
        let arg: BabelNode | undefined;
        if (node.callee.type === "Import") arg = node.arguments[0] as BabelNode | undefined;
        else if (node.callee.type === "Identifier" && node.callee.name === "require") arg = node.arguments[0] as BabelNode | undefined;
        else if (node.callee.type === "Identifier" && node.callee.name === "fetch") arg = node.arguments[0] as BabelNode | undefined;
        else if (node.callee.type === "MemberExpression" && node.callee.object.type === "Identifier" && node.callee.object.name === "axios" && node.callee.property.type === "Identifier" && /^(get|post|put|patch|delete|request)$/.test(node.callee.property.name)) arg = node.arguments[0] as BabelNode | undefined;
        else if (node.callee.type === "MemberExpression" && node.callee.object.type === "Identifier" && node.callee.object.name === "XMLHttpRequest" && node.callee.property.type === "Identifier" && node.callee.property.name === "open") arg = node.arguments[1] as BabelNode | undefined;
        const found = template(arg);
        if (found) {
          const api = node.callee.type === "Identifier" && node.callee.name === "fetch" || node.callee.type === "MemberExpression" && node.callee.object.type === "Identifier" && (node.callee.object.name === "axios" || node.callee.object.name === "XMLHttpRequest");
          references.push({ specifier: found.value, line: node.loc?.start.line ?? 1, kind: api ? "calls-api" : "imports", confidence: found.dynamic ? "possible" : "certain" });
        }
      }
      for (const value of Object.values(node as unknown as Record<string, unknown>)) {
        if (Array.isArray(value)) {
          for (const child of value) if (child && typeof child === "object" && "type" in child) visit(child as BabelNode);
        } else if (value && typeof value === "object" && "type" in value) visit(value as BabelNode);
      }
    };
    visit(ast);
  } catch {
    // Caller logs a warning; malformed files must not stop a project scan.
  }
  return references;
}

/** Parse with an error result exposed for the scanner's warning callback. */
export function validateJavaScript(source: string, filename = "source.js"): void {
  parse(source, {
    sourceType: "unambiguous",
    sourceFilename: filename,
    plugins: ["typescript", "jsx", "decorators-legacy", "dynamicImport", "importMeta"],
    errorRecovery: false,
  });
}
