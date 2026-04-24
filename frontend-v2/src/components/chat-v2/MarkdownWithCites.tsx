import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

interface Props {
  content: string;
  onCiteClick: (n: number) => void;
}

const RE = /\[(\d+)\]/g;

function renderText(text: string, onClick: (n: number) => void): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(RE)) {
    const n = Number(m[1]);
    const start = m.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <span
        key={`c${start}-${n}`}
        className="cite"
        role="button"
        tabIndex={0}
        onClick={() => onClick(n)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick(n);
          }
        }}
      >
        {n}
      </span>
    );
    last = start + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  if (parts.length === 1 && typeof parts[0] === "string") return parts[0];
  return <>{parts}</>;
}

function mapChildren(children: ReactNode, onClick: (n: number) => void): ReactNode {
  if (typeof children === "string") return renderText(children, onClick);
  if (Array.isArray(children)) {
    return children.map((c, i) => {
      if (typeof c === "string") return <span key={i}>{renderText(c, onClick)}</span>;
      return c;
    });
  }
  return children;
}

export function MarkdownWithCites({ content, onCiteClick }: Props) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        p({ children, ...props }) {
          return <p {...props}>{mapChildren(children, onCiteClick)}</p>;
        },
        li({ children, ...props }) {
          return <li {...props}>{mapChildren(children, onCiteClick)}</li>;
        },
        h4: ({ children, ...props }) => <h4 {...props}>{children}</h4>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
