import { memo, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

const SHIKI_LANGS = ["typescript", "javascript", "json", "bash", "python", "rust", "tsx"] as const;

let highlighterPromise: Promise<(code: string, lang: string) => string> | null = null;

function getHighlighter() {
  highlighterPromise ??= import("shiki").then(async (shiki) => {
    const h = await shiki.createHighlighter({ themes: ["github-dark-default"], langs: [...SHIKI_LANGS] });
    return (code: string, lang: string) => {
      try {
        return h.codeToHtml(code, { lang, theme: "github-dark-default" });
      } catch {
        return "";
      }
    };
  });
  return highlighterPromise;
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState("");
  useEffect(() => {
    let cancelled = false;
    getHighlighter().then((highlight) => {
      if (!cancelled) setHtml(highlight(code, lang));
    });
    return () => {
      cancelled = true;
    };
  }, [code, lang]);
  if (!html) {
    return (
      <pre className="overflow-x-auto rounded-md border border-border bg-muted p-3 text-[12px]">
        <code>{code}</code>
      </pre>
    );
  }
  return (
    <div
      className="overflow-x-auto rounded-md border border-border text-[12px] [&_pre]:p-3"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export const ChatMarkdown = memo(function ChatMarkdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("mv-chatmarkdown min-w-0 space-y-3 text-[13px] leading-relaxed text-foreground", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: (props) => (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-[12px]" {...props} />
            </div>
          ),
          th: (props) => <th className="border-b border-border bg-muted px-3 py-2 text-left font-medium" {...props} />,
          td: (props) => <td className="border-b border-border px-3 py-2" {...props} />,
          code: ({ className: cls, children, ...rest }) => {
            const match = /language-(\w+)/.exec(cls ?? "");
            const text = String(children).replace(/\n$/, "");
            if (!match && !text.includes("\n")) {
              return (
                <code className="rounded-sm border border-border bg-muted px-1 py-0.5 text-[12px]" {...rest}>
                  {children}
                </code>
              );
            }
            return <CodeBlock code={text} lang={match?.[1] ?? "text"} />;
          },
          a: (props) => <a className="text-accent underline underline-offset-2" target="_blank" rel="noreferrer" {...props} />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
