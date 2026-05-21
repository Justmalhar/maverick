// Model registry: context window, cost-per-token, default model per backend.
import { useState } from "react";
import { Input } from "@/components/ui/input";

interface ModelRow {
  backend: string;
  model: string;
  contextWindow: number;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
}

const DEFAULT_MODELS: ModelRow[] = [
  { backend: "claude", model: "claude-sonnet-4-5", contextWindow: 200000, inputCostPerMillion: 3, outputCostPerMillion: 15 },
  { backend: "codex", model: "gpt-5", contextWindow: 128000, inputCostPerMillion: 2.5, outputCostPerMillion: 10 },
  { backend: "gemini", model: "gemini-2.5-pro", contextWindow: 1000000, inputCostPerMillion: 1.25, outputCostPerMillion: 5 },
];

export default function ModelsSettings() {
  const [rows, setRows] = useState<ModelRow[]>(DEFAULT_MODELS);

  const updateRow = (idx: number, patch: Partial<ModelRow>) => {
    setRows((curr) => curr.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  return (
    <section data-testid="models-settings" className="space-y-3">
      <h3 className="text-sm font-medium text-foreground">Models</h3>
      <div className="overflow-x-auto rounded-sm border border-border">
        <table className="w-full text-xs">
          <thead className="bg-card/40 text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-2 py-1 text-left">Backend</th>
              <th className="px-2 py-1 text-left">Model ID</th>
              <th className="px-2 py-1 text-right">Context</th>
              <th className="px-2 py-1 text-right">$/M in</th>
              <th className="px-2 py-1 text-right">$/M out</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.backend} className="border-t border-border/40">
                <td className="px-2 py-1 font-mono">{r.backend}</td>
                <td className="px-2 py-1">
                  <Input
                    data-testid={`model-${r.backend}`}
                    value={r.model}
                    onChange={(e) => updateRow(i, { model: e.target.value })}
                  />
                </td>
                <td className="px-2 py-1 text-right">
                  <Input
                    type="number"
                    value={r.contextWindow}
                    onChange={(e) => updateRow(i, { contextWindow: Number(e.target.value) })}
                    className="text-right"
                  />
                </td>
                <td className="px-2 py-1 text-right">
                  <Input
                    type="number"
                    step="0.01"
                    value={r.inputCostPerMillion}
                    onChange={(e) => updateRow(i, { inputCostPerMillion: Number(e.target.value) })}
                    className="text-right"
                  />
                </td>
                <td className="px-2 py-1 text-right">
                  <Input
                    type="number"
                    step="0.01"
                    value={r.outputCostPerMillion}
                    onChange={(e) => updateRow(i, { outputCostPerMillion: Number(e.target.value) })}
                    className="text-right"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
