import { describe, it, expect, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, within } from "@/test/utils";
import { ReviewComments } from "./ReviewComments";
import { useReviewComments, selectCommentsForWorkspace } from "@/lib/stores/review-comments";

beforeEach(() => {
  useReviewComments.setState({ comments: [] });
});

const FILES = ["src/a.ts", "src/b.ts"];

describe("ReviewComments", () => {
  it("adds a comment via the composer scoped to the workspace and file", async () => {
    renderWithProviders(<ReviewComments workspaceId="w1" files={FILES} />);
    await userEvent.selectOptions(screen.getByTestId("review-comment-file"), "src/b.ts");
    await userEvent.clear(screen.getByTestId("review-comment-line"));
    await userEvent.type(screen.getByTestId("review-comment-line"), "42");
    await userEvent.type(screen.getByTestId("review-comment-body"), "extract this");
    await userEvent.click(screen.getByTestId("review-comment-add"));

    const list = selectCommentsForWorkspace("w1")(useReviewComments.getState());
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ file: "src/b.ts", line: 42, body: "extract this", side: "new" });
  });

  it("does not add a comment with an empty body", async () => {
    renderWithProviders(<ReviewComments workspaceId="w1" files={FILES} />);
    await userEvent.click(screen.getByTestId("review-comment-add"));
    expect(useReviewComments.getState().comments).toHaveLength(0);
  });

  it("lists existing comments for the workspace with file and line", () => {
    useReviewComments.getState().addComment({ workspaceId: "w1", file: "src/a.ts", line: 5, side: "new", body: "typo" });
    renderWithProviders(<ReviewComments workspaceId="w1" files={FILES} />);
    const item = screen.getByTestId("review-comment-item-" + commentId());
    expect(item).toHaveTextContent("src/a.ts");
    expect(item).toHaveTextContent("5");
    expect(item).toHaveTextContent("typo");
  });

  it("deletes a comment", async () => {
    useReviewComments.getState().addComment({ workspaceId: "w1", file: "src/a.ts", line: 5, side: "new", body: "typo" });
    renderWithProviders(<ReviewComments workspaceId="w1" files={FILES} />);
    await userEvent.click(within(screen.getByTestId("review-comment-item-" + commentId())).getByTestId("review-comment-delete"));
    expect(useReviewComments.getState().comments).toHaveLength(0);
  });

  it("edits a comment's body", async () => {
    useReviewComments.getState().addComment({ workspaceId: "w1", file: "src/a.ts", line: 5, side: "new", body: "old" });
    renderWithProviders(<ReviewComments workspaceId="w1" files={FILES} />);
    const item = screen.getByTestId("review-comment-item-" + commentId());
    await userEvent.click(within(item).getByTestId("review-comment-edit"));
    const input = within(item).getByTestId("review-comment-edit-input");
    await userEvent.clear(input);
    await userEvent.type(input, "new body");
    await userEvent.click(within(item).getByTestId("review-comment-edit-save"));
    expect(useReviewComments.getState().comments[0].body).toBe("new body");
  });

  it("shows nothing to comment on when there are no changed files and no comments", () => {
    renderWithProviders(<ReviewComments workspaceId="w1" files={[]} />);
    expect(screen.getByTestId("review-comments-empty")).toBeInTheDocument();
  });
});

/** The most-recently-added comment's id (single-comment tests). */
function commentId(): string {
  return useReviewComments.getState().comments[0].id;
}
