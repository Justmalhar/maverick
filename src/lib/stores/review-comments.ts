import { create } from "zustand";

export interface ReviewComment {
  id: string;
  workspaceId: string;
  /** Repo-relative path of the file the comment is anchored to. */
  file: string;
  /** 1-based line number on the chosen side of the diff. */
  line: number;
  /** Which side of the diff the line belongs to. */
  side: "old" | "new";
  body: string;
}

interface ReviewCommentsState {
  comments: ReviewComment[];
  /** Add a comment; returns the generated id. */
  addComment: (input: Omit<ReviewComment, "id">) => string;
  updateComment: (id: string, body: string) => void;
  removeComment: (id: string) => void;
  clearForWorkspace: (workspaceId: string) => void;
}

let seq = 0;

export const useReviewComments = create<ReviewCommentsState>((set) => ({
  comments: [],
  addComment: (input) => {
    const id = `rc-${++seq}`;
    set((s) => ({ comments: [...s.comments, { ...input, id }] }));
    return id;
  },
  updateComment: (id, body) =>
    set((s) => ({
      comments: s.comments.map((c) => (c.id === id ? { ...c, body } : c)),
    })),
  removeComment: (id) =>
    set((s) => ({ comments: s.comments.filter((c) => c.id !== id) })),
  clearForWorkspace: (workspaceId) =>
    set((s) => ({ comments: s.comments.filter((c) => c.workspaceId !== workspaceId) })),
}));

/** Selector: every comment anchored to a given workspace, insertion order. */
export const selectCommentsForWorkspace =
  (workspaceId: string) =>
  (s: ReviewCommentsState): ReviewComment[] =>
    s.comments.filter((c) => c.workspaceId === workspaceId);
