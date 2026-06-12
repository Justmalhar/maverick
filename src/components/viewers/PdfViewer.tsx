import PDFPreview from "@/panels/preview/PDFPreview";
import type { ViewerProps } from "@/lib/viewers/types";

export default function PdfViewer({ tab }: ViewerProps) {
  return <PDFPreview filePath={tab.path} />;
}
