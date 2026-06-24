import { describe, it, expect, beforeEach } from "vitest";
import {
  useReviewComments,
  selectCommentsForWorkspace,
} from "./review-comments";

beforeEach(() => {
  useReviewComments.setState({ comments: [] });
});

describe("review-comments store", () => {
  it("adds a comment scoped to a workspace and returns its id", () => {
    const id = useReviewComments
      .getState()
      .addComment({ workspaceId: "w1", file: "src/a.ts", line: 12, side: "new", body: "nit" });
    const list = selectCommentsForWorkspace("w1")(useReviewComments.getState());
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, file: "src/a.ts", line: 12, side: "new", body: "nit" });
  });

  it("supports multiple comments including on the same line", () => {
    const add = useReviewComments.getState().addComment;
    add({ workspaceId: "w1", file: "src/a.ts", line: 12, side: "new", body: "first" });
    add({ workspaceId: "w1", file: "src/a.ts", line: 12, side: "new", body: "second" });
    expect(selectCommentsForWorkspace("w1")(useReviewComments.getState())).toHaveLength(2);
  });

  it("updates a comment's body", () => {
    const id = useReviewComments
      .getState()
      .addComment({ workspaceId: "w1", file: "a.ts", line: 1, side: "new", body: "old" });
    useReviewComments.getState().updateComment(id, "new body");
    expect(selectCommentsForWorkspace("w1")(useReviewComments.getState())[0].body).toBe("new body");
  });

  it("removes a comment by id", () => {
    const id = useReviewComments
      .getState()
      .addComment({ workspaceId: "w1", file: "a.ts", line: 1, side: "new", body: "x" });
    useReviewComments.getState().removeComment(id);
    expect(selectCommentsForWorkspace("w1")(useReviewComments.getState())).toHaveLength(0);
  });

  it("clears only the target workspace's comments", () => {
    const add = useReviewComments.getState().addComment;
    add({ workspaceId: "w1", file: "a.ts", line: 1, side: "new", body: "a" });
    add({ workspaceId: "w2", file: "b.ts", line: 2, side: "new", body: "b" });
    useReviewComments.getState().clearForWorkspace("w1");
    expect(selectCommentsForWorkspace("w1")(useReviewComments.getState())).toHaveLength(0);
    expect(selectCommentsForWorkspace("w2")(useReviewComments.getState())).toHaveLength(1);
  });

  it("scopes the selector to the requested workspace", () => {
    const add = useReviewComments.getState().addComment;
    add({ workspaceId: "w1", file: "a.ts", line: 1, side: "new", body: "a" });
    add({ workspaceId: "w2", file: "b.ts", line: 2, side: "new", body: "b" });
    expect(selectCommentsForWorkspace("w2")(useReviewComments.getState())).toHaveLength(1);
  });
});
