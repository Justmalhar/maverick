// Full keybinding table sourced from src/shortcuts/registry. Read-only for v0.1.
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { KEYBINDINGS, type KeybindingDef } from "@/shortcuts/registry";

export default function KeybindingsSettings() {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    if (!query) return KEYBINDINGS;
    const q = query.toLowerCase();
    return KEYBINDINGS.filter(
      (k) =>
        k.label.toLowerCase().includes(q) ||
        k.id.toLowerCase().includes(q) ||
        k.keys.toLowerCase().includes(q)
    );
  }, [query]);

  const byCategory = useMemo(() => {
    const map = new Map<KeybindingDef["category"], KeybindingDef[]>();
    for (const k of filtered) {
      if (!map.has(k.category)) map.set(k.category, []);
      map.get(k.category)!.push(k);
    }
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <section data-testid="keybindings-settings" className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">Keybindings</h3>
        <span className="text-[10px] text-muted-foreground">
          v0.1 — rebinding coming soon
        </span>
      </div>
      <Input
        data-testid="keybindings-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter by action or key…"
      />
      <div className="space-y-2">
        {byCategory.map(([cat, items]) => (
          <div key={cat} className="rounded-sm border border-border">
            <div className="border-b border-border bg-card/40 px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              {cat}
            </div>
            <table className="w-full text-xs">
              <tbody>
                {items.map((k) => (
                  <tr
                    key={k.id}
                    data-testid={`keybinding-${k.id}`}
                    className="border-t border-border/40"
                  >
                    <td className="w-[40%] truncate px-2 py-1 text-foreground">
                      {k.label}
                    </td>
                    <td className="w-[35%] truncate px-2 py-1 font-mono text-[10px] text-muted-foreground">
                      {k.id}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <Badge variant="outline" className="font-mono">
                        {k.display ?? k.keys}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </section>
  );
}
