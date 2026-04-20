import { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Citation } from "./Citation";

interface Props {
  content: string;
  onCitationClick: (n: number) => void;
}

const RE = /\[(\d+)\]/g;

function renderText(text: string, onClick: (n: number) => void): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(RE)) {
    const n = Number(m[1]);
    const start = m.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(<Citation key={`c${start}-${n}`} n={n} onClick={onClick} />);
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

export function MessageContent({ content, onCitationClick }: Props) {
  return (
    <div className="max-w-none text-black text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p({ children, ...props }) {
            return <p {...props}>{mapChildren(children, onCitationClick)}</p>;
          },
          li({ children, ...props }) {
            return <li {...props}>{mapChildren(children, onCitationClick)}</li>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
