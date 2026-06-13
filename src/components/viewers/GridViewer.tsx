import { useEffect, useMemo, useState } from "react";
import { FixedSizeList, type ListChildComponentProps } from "react-window";
import { ArrowDown, ArrowUp } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { fileRead } from "@/lib/tauri";
import { parseDelimited, sortRows, type SortDir, type Table } from "@/lib/viewers/grid/parse-table";
import type { ViewerProps } from "@/lib/viewers/types";
import { cn } from "@/lib/utils";

const ROW_HEIGHT = 24;
const VIRTUALIZE_THRESHOLD = 50;

async function loadXlsx(path: string): Promise<Table> {
  const XLSX = await import("xlsx");
  const buf = await (await fetch(convertFileSrc(path))).arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 }) as unknown[][];
  if (data.length === 0) return { header: [], rows: [] };
  return {
    header: data[0].map(String),
    rows: data.slice(1).map((r) => r.map((c) => (c === undefined || c === null ? "" : String(c)))),
  };
}

export default function GridViewer({ tab, meta, registerActions }: ViewerProps) {
  const [table, setTable] = useState<Table>({ header: [], rows: [] });
  const [sort, setSort] = useState<{ col: number; dir: SortDir } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<Table> => {
      if (meta.ext === "xlsx") return loadXlsx(tab.path);
      const res = await fileRead(tab.path);
      const delimiter = meta.ext === "tsv" ? "\t" : ",";
      return parseDelimited(res.content, delimiter);
    };
    load().then((t) => {
      if (!cancelled) setTable(t);
    });
    return () => {
      cancelled = true;
    };
  }, [tab.path, meta.ext]);

  useEffect(() => {
    registerActions({
      copyContents: async () => {
        const text = [table.header, ...table.rows].map((r) => r.join("\t")).join("\n");
        await navigator.clipboard.writeText(text);
      },
    });
  }, [table, registerActions]);

  const rows = useMemo(
    () => (sort ? sortRows(table.rows, sort.col, sort.dir) : table.rows),
    [table.rows, sort]
  );

  const onSort = (col: number) =>
    setSort((s) =>
      s?.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: "asc" }
    );

  const gridTemplate = `repeat(${table.header.length}, minmax(120px, 1fr))`;

  const Row = ({ row }: { row: string[] }) => (
    <div role="row" className="grid border-b border-border" style={{ gridTemplateColumns: gridTemplate }}>
      {row.map((cell, i) => (
        <div role="cell" key={i} className="truncate px-2 py-1 text-[11px] text-foreground">
          {cell}
        </div>
      ))}
    </div>
  );

  return (
    <div role="table" aria-label={meta.name} className="flex h-full flex-col overflow-auto">
      <div role="row" className="sticky top-0 z-base grid border-b border-border bg-muted" style={{ gridTemplateColumns: gridTemplate }}>
        {table.header.map((h, i) => (
          <button
            key={i}
            type="button"
            role="columnheader"
            onClick={() => onSort(i)}
            className={cn(
              "flex items-center gap-1 px-2 py-1 text-left text-[11px] font-semibold text-foreground",
              "hover:bg-foreground/5"
            )}
          >
            <span className="truncate">{h}</span>
            {sort?.col === i &&
              (sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
          </button>
        ))}
      </div>
      {rows.length > VIRTUALIZE_THRESHOLD ? (
        <FixedSizeList height={600} width="100%" itemCount={rows.length} itemSize={ROW_HEIGHT}>
          {({ index, style }: ListChildComponentProps) => (
            <div style={style}>
              <Row row={rows[index]} />
            </div>
          )}
        </FixedSizeList>
      ) : (
        rows.map((row, i) => <Row key={i} row={row} />)
      )}
    </div>
  );
}
