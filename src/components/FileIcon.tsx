import { fileIconUrl, folderIconUrl } from "@/lib/file-icons";
import { cn } from "@/lib/utils";

interface Props {
  name: string;
  isDirectory?: boolean;
  expanded?: boolean;
  className?: string;
}

export function FileIcon({ name, isDirectory = false, expanded = false, className }: Props) {
  const src = isDirectory ? folderIconUrl(name, expanded) : fileIconUrl(name);
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      draggable={false}
      loading="lazy"
      className={cn("h-3.5 w-3.5 shrink-0", className)}
    />
  );
}
