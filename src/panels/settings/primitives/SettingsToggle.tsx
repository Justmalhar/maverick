import { Switch } from "@/components/ui/switch";

interface Props {
  label: string;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  "data-testid"?: string;
}

export function SettingsToggle({
  label,
  checked,
  onCheckedChange,
  disabled,
  "data-testid": testId,
}: Props) {
  return (
    <Switch
      aria-label={label}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      data-testid={testId}
    />
  );
}
