// WYSIWYG element capture overlay — dispatches a window event picked up by InputBar.
// Iframes from other origins cannot be introspected; a TODO marks the native WebviewWindow
// path that will use postMessage with an injected content script.
import { useEffect, useRef, useState, type RefObject } from "react";

interface Props {
  iframeRef: RefObject<HTMLIFrameElement | null>;
}

interface CapturedElement {
  selector: string;
  text: string;
  html: string;
}

export default function ElementInspector({ iframeRef }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [hoverRect, setHoverRect] = useState<DOMRect | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handle = (e: MouseEvent) => {
      try {
        const doc = iframe.contentDocument;
        if (!doc) {
          setError("Iframe document inaccessible (cross-origin)");
          return;
        }
        const iframeRect = iframe.getBoundingClientRect();
        const target = doc.elementFromPoint(e.clientX - iframeRect.left, e.clientY - iframeRect.top);
        if (!target || !(target instanceof HTMLElement)) return;
        const tRect = target.getBoundingClientRect();
        setHoverRect(
          new DOMRect(
            iframeRect.left + tRect.left,
            iframeRect.top + tRect.top,
            tRect.width,
            tRect.height
          )
        );
      } catch (err) {
        setError(String(err));
      }
    };

    const click = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        const doc = iframe.contentDocument;
        if (!doc) return;
        const iframeRect = iframe.getBoundingClientRect();
        const target = doc.elementFromPoint(e.clientX - iframeRect.left, e.clientY - iframeRect.top);
        if (!target || !(target instanceof HTMLElement)) return;
        const captured: CapturedElement = {
          selector: cssPath(target),
          text: target.innerText?.slice(0, 240) ?? "",
          html: target.outerHTML.slice(0, 2000),
        };
        window.dispatchEvent(
          new CustomEvent("maverick:input-append", {
            detail: {
              text: `@selector:${captured.selector} ${captured.text ? `// ${captured.text}` : ""}`,
            },
          })
        );
      } catch (err) {
        setError(String(err));
      }
    };

    const overlay = overlayRef.current;
    overlay?.addEventListener("mousemove", handle);
    overlay?.addEventListener("click", click);
    return () => {
      overlay?.removeEventListener("mousemove", handle);
      overlay?.removeEventListener("click", click);
    };
  }, [iframeRef]);

  return (
    <div
      ref={overlayRef}
      data-testid="element-inspector"
      className="pointer-events-auto absolute inset-0 z-10 cursor-crosshair bg-primary/5"
    >
      {hoverRect && (
        <div
          data-testid="element-inspector-highlight"
          className="pointer-events-none fixed border-2 border-primary bg-primary/15"
          style={{
            top: hoverRect.top,
            left: hoverRect.left,
            width: hoverRect.width,
            height: hoverRect.height,
          }}
        />
      )}
      {error && (
        <div className="absolute bottom-2 left-2 right-2 rounded-sm border border-destructive bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}

function cssPath(el: HTMLElement): string {
  const parts: string[] = [];
  let node: HTMLElement | null = el;
  while (node && node.nodeType === 1 && parts.length < 6) {
    let part = node.tagName.toLowerCase();
    if (node.id) {
      part += `#${node.id}`;
      parts.unshift(part);
      break;
    }
    const className = typeof node.className === "string" ? node.className : "";
    if (className) {
      part += `.${className.trim().split(/\s+/).slice(0, 2).join(".")}`;
    }
    parts.unshift(part);
    node = node.parentElement;
  }
  return parts.join(" > ");
}
