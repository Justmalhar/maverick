import { describe, expect, it } from "vitest";
import { parseDelimited, sortRows } from "./parse-table";

describe("parseDelimited", () => {
  it("parses CSV with a header row", () => {
    const t = parseDelimited("name,qty\napple,3\nbanana,5", ",");
    expect(t.header).toEqual(["name", "qty"]);
    expect(t.rows).toEqual([["apple", "3"], ["banana", "5"]]);
  });

  it("parses TSV", () => {
    const t = parseDelimited("a\tb\n1\t2", "\t");
    expect(t.header).toEqual(["a", "b"]);
    expect(t.rows).toEqual([["1", "2"]]);
  });

  it("handles quoted fields with embedded delimiters", () => {
    const t = parseDelimited('name,note\nx,"a, b"', ",");
    expect(t.rows[0]).toEqual(["x", "a, b"]);
  });

  it("empty input yields empty table", () => {
    expect(parseDelimited("", ",")).toEqual({ header: [], rows: [] });
  });

  it("all-whitespace input yields empty table (trim branch)", () => {
    expect(parseDelimited("   \n\t  ", ",")).toEqual({ header: [], rows: [] });
  });
});

describe("sortRows", () => {
  const rows = [["banana", "5"], ["apple", "3"], ["cherry", "10"]];

  it("sorts strings ascending and descending", () => {
    expect(sortRows(rows, 0, "asc")[0][0]).toBe("apple");
    expect(sortRows(rows, 0, "desc")[0][0]).toBe("cherry");
  });

  it("sorts numerically when every value is numeric", () => {
    expect(sortRows(rows, 1, "asc").map((r) => r[1])).toEqual(["3", "5", "10"]);
  });

  it("does not mutate the input", () => {
    sortRows(rows, 0, "asc");
    expect(rows[0][0]).toBe("banana");
  });
});
