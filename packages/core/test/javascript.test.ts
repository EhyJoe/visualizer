import { describe, expect, it } from "vitest";
import { parseJavaScript } from "../src/parsers/javascript.js";

describe("parseJavaScript", () => {
  it("extracts imports, named and star re-exports, require and dynamic imports with lines", () => {
    const refs = parseJavaScript(`import x from './x.js';\nexport * from './y.js';\nexport { y } from './z.js';\nconst z = require('./w');\nimport('./lazy.js');`);
    expect(refs.map((ref) => [ref.specifier, ref.line, ref.confidence])).toEqual([
      ["./x.js", 1, "certain"], ["./y.js", 2, "certain"], ["./z.js", 3, "certain"], ["./w", 4, "certain"], ["./lazy.js", 5, "certain"],
    ]);
  });

  it("marks variable template imports possible and survives malformed code", () => {
    expect(parseJavaScript("import(`./${name}.js`)")[0]?.confidence).toBe("possible");
    expect(parseJavaScript("const = ;")).toEqual([]);
  });
});
