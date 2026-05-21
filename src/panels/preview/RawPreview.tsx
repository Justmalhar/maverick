// Raw text fallback — pre-formatted with hex toggle for non-printable input.
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Props {
  filePath: string;
  content?: string;
}

function toHex(text: string): string {
  const bytes: string[] = [];
  for (let i = 0; i < text.length; i += 16) {
    const slice = text.slice(i, i + 16);
    const hex = Array.from(slice)
      .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
      .join(" ");
    const ascii = Array.from(slice)
      .map((c) => {
        const code = c.charCodeAt(0);
        return code >= 32 && code < 127 ? c : ".";
      })
      .join("");
    bytes.push(
      `${i.toString(16).padStart(8, "0")}  ${hex.padEnd(48, " ")}  ${ascii}`
    );
  }
  return bytes.join("\n");
}

export default function RawPreview({ filePath, content }: Props) {
  const [mode, setMode] = useState<"text" | "hex">("text");
  const text = content ?? "";
  const hex = useMemo(() => (mode === "hex" ? toHex(text) : ""), [text, mode]);

  return (
    <div data-testid="raw-preview" className="flex h-full w-full flex-col">
      <div className="flex items-center gap-2 border-b border-border bg-card/30 px-2 py-1">
        <span className="text-[11px] text-muted-foreground">{filePath}</span>
        <div className="flex-1" />
        <Button
          size="sm"
          variant={mode === "text" ? "default" : "ghost"}
          onClick={() => setMode("text")}
          data-testid="raw-text"
        >
          Text
        </Button>
        <Button
          size="sm"
          variant={mode === "hex" ? "default" : "ghost"}
          onClick={() => setMode("hex")}
          data-testid="raw-hex"
        >
          Hex
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <pre className="whitespace-pre p-3 font-mono text-[11px] text-foreground">
          {mode === "text" ? text : hex}
        </pre>
      </ScrollArea>
    </div>
  );
}
