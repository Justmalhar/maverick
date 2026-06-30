import { Loader2, Sparkles } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

export function CommitBox({
  value,
  onChange,
  onGenerate,
  onSubmit,
  generating,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onGenerate: () => void;
  onSubmit: () => void;
  generating: boolean;
  disabled: boolean;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        data-testid="scm-message"
        className="resize-none pr-8 font-mono text-[11px]"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") onSubmit();
        }}
      />
      <button
        type="button"
        onClick={onGenerate}
        disabled={disabled}
        aria-label="Generate commit message"
        data-testid="scm-generate"
        className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-sm text-accent transition-colors duration-100 hover:bg-sidebar-hover disabled:opacity-60"
      >
        {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
