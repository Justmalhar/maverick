import ImagePreview from "@/panels/preview/ImagePreview";
import VideoPreview from "@/panels/preview/VideoPreview";
import type { ViewerProps } from "@/lib/viewers/types";

export function ImageViewer({ tab }: ViewerProps) {
  return <ImagePreview filePath={tab.path} />;
}

export function VideoViewer({ tab }: ViewerProps) {
  return <VideoPreview filePath={tab.path} />;
}
