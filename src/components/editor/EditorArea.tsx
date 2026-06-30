import { useEffect } from "react";
import { EditorGroup } from "./EditorGroup";
import { prewarmEditor } from "@/lib/viewers/prewarm";

export function EditorArea() {
  useEffect(() => {
    prewarmEditor();
  }, []);

  return (
    <main
      data-testid="editor-area"
      className="mv-editorarea flex h-full w-full flex-col overflow-hidden bg-editor"
    >
      <EditorGroup />
    </main>
  );
}
