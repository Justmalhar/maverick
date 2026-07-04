import { BarChart3, Check, Sparkles } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import type { AgentModelOption } from "@/lib/ipc";

interface MenuProps {
  value: string | null;
  options: AgentModelOption[];
  onSelect: (id: string) => void;
}

function OptionMenu({ value, options, onSelect, icon: Icon, ariaLabel }: MenuProps & { icon: typeof Sparkles; ariaLabel: string }) {
  const current = options.find((o) => o.id === (value ?? "default")) ?? options[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${ariaLabel}: ${current?.label ?? "Default"}`}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors duration-100 hover:bg-muted hover:text-foreground"
        >
          <Icon className="h-3.5 w-3.5" />
          {current?.label ?? "Default"}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {options.map((o) => (
          <DropdownMenuItem key={o.id} onClick={() => onSelect(o.id)} className="text-[12px]">
            <span className="flex-1">{o.label}</span>
            {o.id === (value ?? "default") && <Check className="h-3 w-3" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ModelMenu(props: MenuProps) {
  return <OptionMenu {...props} icon={Sparkles} ariaLabel="Model" />;
}

export function ReasoningMenu(props: MenuProps) {
  return <OptionMenu {...props} icon={BarChart3} ariaLabel="Reasoning level" />;
}
