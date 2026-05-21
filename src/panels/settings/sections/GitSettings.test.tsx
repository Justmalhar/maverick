import { describe, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, fireEvent } from "@/test/utils";
import GitSettings from "./GitSettings";

describe("GitSettings", () => {
  it("edits remote, template, autofetch, and toggles GPG", async () => {
    renderWithProviders(<GitSettings />);
    fireEvent.change(screen.getByTestId("git-remote"), { target: { value: "upstream" } });
    fireEvent.change(screen.getByTestId("git-template"), { target: { value: "tpl" } });
    fireEvent.change(screen.getByTestId("git-autofetch"), { target: { value: "10" } });
    await userEvent.click(screen.getByTestId("git-gpg"));
  });
});
