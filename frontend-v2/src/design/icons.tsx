import { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const stroke = {
  viewBox: "0 0 16 16",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const IconChat = (p: IconProps) => (
  <svg {...stroke} {...p}>
    <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h7A1.5 1.5 0 0 1 13 4.5v5A1.5 1.5 0 0 1 11.5 11H7l-3 2.5V11h0A1.5 1.5 0 0 1 3 9.5v-5Z" />
  </svg>
);
export const IconBook = (p: IconProps) => (
  <svg {...stroke} {...p}>
    <path d="M3 3h6a2 2 0 0 1 2 2v8a2 2 0 0 0-2-2H3V3Z" />
    <path d="M13 3h-2a2 2 0 0 0-2 2v6a2 2 0 0 1 2-2h2V3Z" />
  </svg>
);
export const IconCards = (p: IconProps) => (
  <svg {...stroke} {...p}>
    <rect x="2.5" y="4" width="9" height="9" rx="1.5" />
    <path d="M5 2h8.5A1.5 1.5 0 0 1 15 3.5v8" />
  </svg>
);
export const IconQuiz = (p: IconProps) => (
  <svg {...stroke} {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M6.5 6.5a1.5 1.5 0 1 1 2.3 1.3c-.5.3-.8.6-.8 1.2" />
    <circle cx="8" cy="11.3" r=".5" fill="currentColor" />
  </svg>
);
export const IconPlan = (p: IconProps) => (
  <svg {...stroke} {...p}>
    <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
    <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
  </svg>
);
export const IconHome = (p: IconProps) => (
  <svg {...stroke} {...p}>
    <path d="M2.5 8L8 3l5.5 5M4 7v6h8V7" />
  </svg>
);
export const IconLibrary = (p: IconProps) => (
  <svg {...stroke} {...p}>
    <path d="M3 3v10M5 3v10M7.5 3.5l1.8-.3 2 9.6-1.7.3zM12 3h1.5v10H12z" />
  </svg>
);
export const IconSearch = (p: IconProps) => (
  <svg {...stroke} {...p}>
    <circle cx="7" cy="7" r="4" />
    <path d="m13.5 13.5-3.6-3.6" />
  </svg>
);
export const IconSend = (p: IconProps) => (
  <svg {...stroke} strokeWidth={1.7} {...p}>
    <path d="M2.5 8h11M9 3.5 13.5 8 9 12.5" />
  </svg>
);
export const IconPlus = (p: IconProps) => (
  <svg {...stroke} {...p}>
    <path d="M8 3v10M3 8h10" />
  </svg>
);
export const IconClose = (p: IconProps) => (
  <svg {...stroke} {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);
export const IconAttach = (p: IconProps) => (
  <svg {...stroke} {...p}>
    <path d="M11.5 7.5 7.8 11.2a2.5 2.5 0 1 1-3.5-3.5L8.5 3.5a1.7 1.7 0 1 1 2.4 2.4l-4.2 4.2a.9.9 0 0 1-1.3-1.3l3.8-3.8" />
  </svg>
);
export const IconSpark = (p: IconProps) => (
  <svg {...stroke} {...p}>
    <path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l2 2M10 10l2 2M12 4l-2 2M6 10l-2 2" />
  </svg>
);
export const IconList = (p: IconProps) => (
  <svg {...stroke} {...p}>
    <path d="M3 4h10M3 8h10M3 12h7" />
  </svg>
);
export const IconEllipsis = (p: IconProps) => (
  <svg viewBox="0 0 16 16" fill="currentColor" {...p}>
    <circle cx="3" cy="8" r="1.2" />
    <circle cx="8" cy="8" r="1.2" />
    <circle cx="13" cy="8" r="1.2" />
  </svg>
);
export const IconCopy = (p: IconProps) => (
  <svg {...stroke} {...p}>
    <rect x="5" y="5" width="8" height="8" rx="1.3" />
    <path d="M3 11V4a1 1 0 0 1 1-1h7" />
  </svg>
);
export const IconThumb = (p: IconProps) => (
  <svg {...stroke} {...p}>
    <path d="M5 7v6H3V7zM5 7l3-4.5c1 0 1.5.7 1.3 1.7L9 7h3.5a1.5 1.5 0 0 1 1.5 1.7l-.7 3.3a1.5 1.5 0 0 1-1.5 1.2H5" />
  </svg>
);
export const IconRefresh = (p: IconProps) => (
  <svg {...stroke} {...p}>
    <path d="M13 8a5 5 0 1 1-1.5-3.5M13 3v2.5h-2.5" />
  </svg>
);
export const IconArrow = (p: IconProps) => (
  <svg {...stroke} {...p}>
    <path d="M3 8h10M9 4l4 4-4 4" />
  </svg>
);
export const IconMax = (p: IconProps) => (
  <svg {...stroke} {...p}>
    <path d="M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3" />
  </svg>
);
export const IconDoc = (p: IconProps) => (
  <svg {...stroke} {...p}>
    <path d="M4 2h5l3 3v9H4zM9 2v3h3" />
  </svg>
);
export const IconTrash = (p: IconProps) => (
  <svg {...stroke} {...p}>
    <path d="M3 4.5h10M6 4.5V3h4v1.5M5 4.5v9a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-9" />
  </svg>
);
export const IconDown = (p: IconProps) => (
  <svg {...stroke} strokeWidth={1.8} {...p}>
    <path d="M8 3v9M4 9l4 4 4-4" />
  </svg>
);
export const IconAlert = (p: IconProps) => (
  <svg {...stroke} strokeWidth={1.6} {...p}>
    <circle cx="8" cy="8" r="6.5" />
    <path d="M8 5v3.5M8 11h.01" />
  </svg>
);
