import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Option {
  value: string;
  label: string;
}

interface Props {
  label: string;
  value: string;
  onValueChange: (next: string) => void;
  options: Option[];
  disabled?: boolean;
  "data-testid"?: string;
}

export function SettingsSelect({
  label,
  value,
  onValueChange,
  options,
  disabled,
  "data-testid": testId,
}: Props) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger
        aria-label={label}
        data-testid={testId}
        className="h-8 w-full max-w-sm border-border/60 bg-muted/50 text-xs hover:bg-muted/70"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value} className="text-xs">
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
