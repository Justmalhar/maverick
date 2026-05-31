import { describe, it, expect, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, fireEvent, act } from "@/test/utils";
import EnvironmentSettings from "./EnvironmentSettings";
import { _resetSettingsStoreForTests, useSettingsStore, getGlobalEnv } from "@/lib/stores/settings";

describe("EnvironmentSettings", () => {
  beforeEach(() => _resetSettingsStoreForTests());

  it("shows the empty state when no variables exist", () => {
    renderWithProviders(<EnvironmentSettings />);
    expect(screen.getByTestId("environment-empty")).toBeInTheDocument();
  });

  it("hydrates existing variables from the store", () => {
    useSettingsStore.setState({ values: { "general.env": JSON.stringify({ A: "1", B: "2" }) } });
    renderWithProviders(<EnvironmentSettings />);
    expect(screen.getByTestId("environment-key-0")).toHaveValue("A");
    expect(screen.getByTestId("environment-value-0")).toHaveValue("1");
    expect(screen.getByTestId("environment-key-1")).toHaveValue("B");
  });

  it("adds, edits, and persists a variable", async () => {
    renderWithProviders(<EnvironmentSettings />);
    await userEvent.click(screen.getByTestId("environment-add"));
    fireEvent.change(screen.getByTestId("environment-key-0"), { target: { value: "TOKEN" } });
    fireEvent.change(screen.getByTestId("environment-value-0"), { target: { value: "abc" } });
    expect(getGlobalEnv()).toEqual({ TOKEN: "abc" });
  });

  it("drops blank keys from the persisted map", async () => {
    renderWithProviders(<EnvironmentSettings />);
    await userEvent.click(screen.getByTestId("environment-add"));
    fireEvent.change(screen.getByTestId("environment-value-0"), { target: { value: "orphan" } });
    expect(getGlobalEnv()).toEqual({});
  });

  it("removes a variable", async () => {
    useSettingsStore.setState({ values: { "general.env": JSON.stringify({ A: "1" }) } });
    renderWithProviders(<EnvironmentSettings />);
    await userEvent.click(screen.getByTestId("environment-remove-0"));
    expect(getGlobalEnv()).toEqual({});
    expect(screen.getByTestId("environment-empty")).toBeInTheDocument();
  });

  it("re-syncs local rows when the store env changes externally", () => {
    useSettingsStore.setState({ values: { "general.env": JSON.stringify({ A: "1" }) } });
    renderWithProviders(<EnvironmentSettings />);
    expect(screen.getByTestId("environment-key-0")).toHaveValue("A");
    act(() => {
      useSettingsStore.setState({
        values: { "general.env": JSON.stringify({ X: "9", Y: "8" }) },
      });
    });
    expect(screen.getByTestId("environment-key-0")).toHaveValue("X");
    expect(screen.getByTestId("environment-value-0")).toHaveValue("9");
    expect(screen.getByTestId("environment-key-1")).toHaveValue("Y");
  });

  it("keeps an in-progress blank row when committing its own writes", async () => {
    renderWithProviders(<EnvironmentSettings />);
    await userEvent.click(screen.getByTestId("environment-add"));
    // Value typed but key still blank — toEnv() drops it, but the row must stay.
    fireEvent.change(screen.getByTestId("environment-value-0"), { target: { value: "orphan" } });
    expect(screen.getByTestId("environment-value-0")).toHaveValue("orphan");
    expect(screen.getByTestId("environment-key-0")).toHaveValue("");
  });
});
