// HTML5 video preview with native controls.
import { useMemo } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

interface Props {
  filePath: string;
}

export default function VideoPreview({ filePath }: Props) {
  // Map the OS path to a WebView-loadable asset URL (a bare `C:\…` path won't load).
  const src = useMemo(() => convertFileSrc(filePath), [filePath]);
  return (
    <div
      data-testid="video-preview"
      className="flex h-full w-full items-center justify-center bg-background"
    >
      <video
        src={src}
        controls
        data-testid="video-preview-el"
        className="max-h-full max-w-full"
      />
    </div>
  );
}
