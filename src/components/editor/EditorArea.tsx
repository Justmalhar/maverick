import { EditorGroup } from "./EditorGroup";

export function EditorArea() {
  return (
    <main
      data-testid="editor-area"
      className="mv-editorarea flex h-full w-full flex-col overflow-hidden bg-editor"
    >
      <EditorGroup />
    </main>
  );
}
