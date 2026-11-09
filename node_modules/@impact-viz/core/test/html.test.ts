import { describe, expect, it } from "vitest";
import { parseHtml } from "../src/parsers/html.js";

describe("parseHtml", () => {
  it("extracts local stylesheet, script, image and anchor references", () => {
    const refs = parseHtml(`<link rel="stylesheet" href="./site.css?v=1">\n<script src="./main.js"></script>\n<img src="./logo.png"><a href="./about.html#team">About</a>`);
    expect(refs.map(({ specifier, line, kind }) => [specifier, line, kind])).toEqual([
      ["./site.css", 1, "links-stylesheet"], ["./main.js", 2, "loads-script"],
      ["./logo.png", 3, "references-asset"], ["./about.html", 3, "references-asset"],
    ]);
  });
});
