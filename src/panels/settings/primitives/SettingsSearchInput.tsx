import { Search } from "lucide-react";
import { forwardRef } from "react";

interface Props {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}

export const SettingsSearchInput = forwardRef<HTMLInputElement, Props>(
  function SettingsSearchInput({ value, onChange, placeholder = "Search…" }, ref) {
    return (
      <label className="relative block">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <input
          ref={ref}
          type="search"
          role="searchbox"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-8 w-full rounded-md bg-transparent pl-7 pr-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          style={{ border: "1px solid hsl(var(--border))" }}
        />
      </label>
    );
  },
);
