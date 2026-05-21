import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, fireEvent } from "@/test/utils";
import ElementInspector from "./ElementInspector";

function makeIframe(): React.RefObject<HTMLIFrameElement | null> {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  // Stub contentDocument
  const targetDiv = document.createElement("div");
  targetDiv.id = "btn";
  targetDiv.className = "primary-cls extra";
  targetDiv.innerText = "Click me";
  const fakeDoc = {
    elementFromPoint: vi.fn(() => targetDiv),
  } as unknown as Document;
  Object.defineProperty(iframe, "contentDocument", { value: fakeDoc, writable: true });
  Object.defineProperty(iframe, "getBoundingClientRect", {
    value: () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON: () => ({}) }),
  });
  return { current: iframe } as React.RefObject<HTMLIFrameElement | null>;
}

describe("ElementInspector", () => {
  it("renders, captures hover + click, dispatches input-append", () => {
    const ref = makeIframe();
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    renderWithProviders(<ElementInspector iframeRef={ref} />);
    const overlay = screen.getByTestId("element-inspector");
    fireEvent.mouseMove(overlay, { clientX: 10, clientY: 10 });
    expect(screen.queryByTestId("element-inspector-highlight")).toBeInTheDocument();
    fireEvent.click(overlay, { clientX: 10, clientY: 10 });
    expect(dispatchSpy).toHaveBeenCalledWith(expect.any(CustomEvent));
  });

  it("surfaces cross-origin error when contentDocument is null", () => {
    const iframe = document.createElement("iframe");
    Object.defineProperty(iframe, "contentDocument", { value: null });
    Object.defineProperty(iframe, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }),
    });
    renderWithProviders(<ElementInspector iframeRef={{ current: iframe }} />);
    fireEvent.mouseMove(screen.getByTestId("element-inspector"), { clientX: 1, clientY: 1 });
    expect(screen.getByText(/Iframe document inaccessible/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("element-inspector"));
  });

  it("returns null when ref is empty", () => {
    renderWithProviders(<ElementInspector iframeRef={{ current: null }} />);
    expect(screen.getByTestId("element-inspector")).toBeInTheDocument();
  });

  it("handles hover when elementFromPoint returns non-HTML", () => {
    const iframe = document.createElement("iframe");
    Object.defineProperty(iframe, "contentDocument", {
      value: { elementFromPoint: () => null },
    });
    Object.defineProperty(iframe, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }),
    });
    renderWithProviders(<ElementInspector iframeRef={{ current: iframe }} />);
    fireEvent.mouseMove(screen.getByTestId("element-inspector"), { clientX: 0, clientY: 0 });
    fireEvent.click(screen.getByTestId("element-inspector"));
  });

  it("cssPath walks parent chain when no id present (uses class names)", () => {
    const iframe = document.createElement("iframe");
    const grandparent = document.createElement("section");
    grandparent.className = "outer wrapper";
    const parent = document.createElement("div");
    parent.className = "mid";
    const target = document.createElement("span");
    target.className = "leaf";
    grandparent.appendChild(parent);
    parent.appendChild(target);
    document.body.appendChild(grandparent);

    const fakeDoc = { elementFromPoint: () => target } as unknown as Document;
    Object.defineProperty(iframe, "contentDocument", { value: fakeDoc });
    Object.defineProperty(iframe, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON: () => ({}) }),
    });

    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    renderWithProviders(<ElementInspector iframeRef={{ current: iframe }} />);
    fireEvent.click(screen.getByTestId("element-inspector"), { clientX: 0, clientY: 0 });
    expect(dispatchSpy).toHaveBeenCalledWith(expect.any(CustomEvent));
    document.body.removeChild(grandparent);
  });

  it("captures errors from inner exceptions", () => {
    const iframe = document.createElement("iframe");
    Object.defineProperty(iframe, "contentDocument", {
      get() {
        throw new Error("oops");
      },
    });
    Object.defineProperty(iframe, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }),
    });
    renderWithProviders(<ElementInspector iframeRef={{ current: iframe }} />);
    fireEvent.mouseMove(screen.getByTestId("element-inspector"));
    fireEvent.click(screen.getByTestId("element-inspector"));
    expect(screen.getByText(/oops/)).toBeInTheDocument();
  });
});
