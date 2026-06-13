import Papa from "papaparse";

export interface Table {
  header: string[];
  rows: string[][];
}

export function parseDelimited(content: string, delimiter: "," | "\t"): Table {
  if (!content.trim()) return { header: [], rows: [] };
  const result = Papa.parse<string[]>(content.trim(), { delimiter, skipEmptyLines: true });
  const data = result.data;
  if (data.length === 0) return { header: [], rows: [] };
  return { header: data[0].map(String), rows: data.slice(1).map((r) => r.map(String)) };
}

export type SortDir = "asc" | "desc";

export function sortRows(rows: string[][], col: number, dir: SortDir): string[][] {
  const numeric = rows.every((r) => r[col] !== "" && !Number.isNaN(Number(r[col])));
  const sorted = [...rows].sort((a, b) => {
    const cmp = numeric
      ? Number(a[col]) - Number(b[col])
      : a[col].localeCompare(b[col]);
    return dir === "asc" ? cmp : -cmp;
  });
  return sorted;
}
