import { useMemo, useState } from "react";
import { MessageSquarePlus, Pencil, Trash2, Check, X } from "lucide-react";
import { useReviewComments } from "@/lib/stores/review-comments";

interface Props {
  workspaceId: string;
  /** Repo-relative paths of the changed files, for the composer's file picker. */
  files: string[];
}

/**
 * Inline review-comment surface for the active workspace's diff. Author a
 * comment anchored to a file + line, then list / edit / delete pending comments.
 * Comments live in the review-comments store and are sent to the agent as a
 * batched `Re:` prompt by the DiffView "Send to agent" action.
 */
export function ReviewComments({ workspaceId, files }: Props) {
  const allComments = useReviewComments((s) => s.comments);
  const addComment = useReviewComments((s) => s.addComment);
  const comments = useMemo(
    () => allComments.filter((c) => c.workspaceId === workspaceId),
    [allComments, workspaceId]
  );

  const [file, setFile] = useState(files[0] ?? "");
  const [line, setLine] = useState("1");
  const [body, setBody] = useState("");

  const effectiveFile = files.includes(file) ? file : files[0] ?? "";

  function onAdd() {
    const trimmed = body.trim();
    if (!trimmed || !effectiveFile) return;
    const parsed = Number.parseInt(line, 10);
    addComment({
      workspaceId,
      file: effectiveFile,
      line: Number.isFinite(parsed) && parsed > 0 ? parsed : 1,
      side: "new",
      body: trimmed,
    });
    setBody("");
  }

  if (files.length === 0 && comments.length === 0) {
    return (
      <div
        data-testid="review-comments-empty"
        className="px-3 py-2 text-[11px] text-muted-foreground"
      >
        No changed files to review.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border px-3 py-2" data-testid="review-comments">
      <span className="text-[10px] uppercase tracking-wider text-sidebar-section">Review comments</span>

      {files.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-1.5">
            <select
              data-testid="review-comment-file"
              value={effectiveFile}
              onChange={(e) => setFile(e.target.value)}
              className="min-w-0 flex-1 truncate rounded-md border border-border bg-card px-2 py-1 text-[11px] text-foreground"
            >
              {files.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
            <input
              data-testid="review-comment-line"
              type="number"
              min={1}
              value={line}
              onChange={(e) => setLine(e.target.value)}
              aria-label="Line number"
              className="w-14 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-foreground"
            />
          </div>
          <textarea
            data-testid="review-comment-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Comment on this line…"
            rows={2}
            className="resize-none rounded-md border border-border bg-card px-2 py-1 text-[11px] text-foreground"
          />
          <button
            type="button"
            data-testid="review-comment-add"
            onClick={onAdd}
            className="flex items-center justify-center gap-1.5 rounded-md bg-sidebar-hover px-2 py-1 text-[11px] font-medium text-foreground transition-colors duration-100 hover:bg-muted"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            Add comment
          </button>
        </div>
      )}

      <ul className="flex flex-col gap-1">
        {comments.map((c) => (
          <CommentItem key={c.id} id={c.id} file={c.file} line={c.line} body={c.body} />
        ))}
      </ul>
    </div>
  );
}

function CommentItem({
  id,
  file,
  line,
  body,
}: {
  id: string;
  file: string;
  line: number;
  body: string;
}) {
  const updateComment = useReviewComments((s) => s.updateComment);
  const removeComment = useReviewComments((s) => s.removeComment);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body);

  function save() {
    const trimmed = draft.trim();
    if (trimmed) updateComment(id, trimmed);
    setEditing(false);
  }

  return (
    <li
      data-testid={`review-comment-item-${id}`}
      className="flex flex-col gap-1 rounded-md border border-border-glass bg-card px-2 py-1.5"
    >
      <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span className="truncate font-mono">
          {file}:{line}
        </span>
        <div className="flex shrink-0 gap-1">
          {!editing && (
            <button
              type="button"
              data-testid="review-comment-edit"
              aria-label="Edit comment"
              onClick={() => {
                setDraft(body);
                setEditing(true);
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
          <button
            type="button"
            data-testid="review-comment-delete"
            aria-label="Delete comment"
            onClick={() => removeComment(id)}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
      {editing ? (
        <div className="flex items-start gap-1">
          <textarea
            data-testid="review-comment-edit-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            className="flex-1 resize-none rounded-md border border-border bg-card px-2 py-1 text-[11px] text-foreground"
          />
          <button
            type="button"
            data-testid="review-comment-edit-save"
            aria-label="Save comment"
            onClick={save}
            className="text-muted-foreground hover:text-success"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Cancel edit"
            onClick={() => setEditing(false)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <p className="whitespace-pre-wrap break-words text-[11px] text-foreground">{body}</p>
      )}
    </li>
  );
}
