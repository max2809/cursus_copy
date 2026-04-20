interface Props {
  checked: boolean;
  onToggle: () => void;
  size?: number;
}

export function Checkbox({ checked, onToggle, size = 18 }: Props) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={checked ? "Mark as not done" : "Mark as done"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      style={{
        width: size,
        height: size,
        border: `2px solid ${checked ? "var(--accent)" : "var(--hair-2)"}`,
        borderRadius: "50%",
        background: checked ? "var(--accent)" : "transparent",
        color: "var(--accent-ink)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        padding: 0,
        flexShrink: 0,
      }}
    >
      {checked && (
        <svg width={Math.round(size * 0.56)} height={Math.round(size * 0.56)} viewBox="0 0 10 10" fill="none">
          <path
            d="M2 5 4 7 8 3"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}
