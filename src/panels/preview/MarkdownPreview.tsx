// react-markdown + remark-gfm with highlight.js fenced code highlighting.
import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import hljs from "highlight.js/lib/common";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Props {
  content: string;
}

export default function MarkdownPreview({ content }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Re-highlight all `pre code` blocks whenever content changes.
  useEffect(() => {
    if (!ref.current) return;
    ref.current.querySelectorAll<HTMLElement>("pre code").forEach((el) => {
      try {
        hljs.highlightElement(el);
      } catch {
        /* highlight.js can throw on unknown languages; ignore */
      }
    });
  }, [content]);

  return (
    <ScrollArea
      className="h-full"
      data-testid="markdown-preview"
    >
      <div
        ref={ref}
        className="prose prose-invert prose-sm max-w-none px-4 py-3 text-foreground prose-headings:text-foreground prose-a:text-primary prose-code:text-foreground prose-pre:bg-card prose-pre:p-3"
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </ScrollArea>
  );
}
