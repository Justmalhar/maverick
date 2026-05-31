// Per-file git blame — line-level commit metadata.
import { useCallback, useEffect, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { gitBlame } from "@/lib/tauri";
import type { BlameLine } from "@/lib/ipc";

interface Props {
  worktreePath: string;
  initialFile?: string;
}

export default function BlameView({ worktreePath, initialFile = "" }: Props) {
  const [filePath, setFilePath] = useState(initialFile);
  const [lines, setLines] = useState<BlameLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!worktreePath || !filePath) return;
    setLoading(true);
    setError(null);
    try {
      const result = await gitBlame(worktreePath, filePath);
      setLines(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [worktreePath, filePath]);

  useEffect(() => {
    if (initialFile) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  return (
    <div data-testid="blame-view" className="flex h-full w-full flex-col bg-background">
      <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
        <Input
          data-testid="blame-file-input"
          value={filePath}
          onChange={(e) => setFilePath(e.target.value)}
          placeholder="path/to/file.ts"
          className="flex-1"
        />
        <Button size="sm" onClick={load} data-testid="blame-load">
          Blame
        </Button>
      </div>
      {loading && (
        <div className="px-3 py-1.5 text-[11px] text-muted-foreground">Loading…</div>
      )}
      {error && (
        <div className="px-3 py-1.5 text-[11px] text-destructive">{error}</div>
      )}
      <ScrollArea className="flex-1">
        <table className="w-full font-mono text-[10px]">
          <tbody>
            {lines.map((line) => (
              <tr key={line.lineNumber} className="border-b border-border/30">
                <td className="px-2 py-0.5 text-muted-foreground" title={line.sha}>
                  {line.sha.slice(0, 7)}
                </td>
                <td className="px-2 py-0.5 text-muted-foreground">{line.author}</td>
                <td className="px-2 py-0.5 text-right text-muted-foreground">
                  {line.lineNumber}
                </td>
                <td className="whitespace-pre px-2 py-0.5">{line.content}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {lines.length === 0 && !loading && (
          <div className="px-3 py-2 text-[11px] text-muted-foreground">
            Enter a file path to view blame.
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
