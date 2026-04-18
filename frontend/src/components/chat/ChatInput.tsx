import { useRef, useState } from "react";

interface Props {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({ onSubmit, disabled, placeholder }: Props) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement | null>(null);

  function submit() {
    const v = value.trim();
    if (!v || disabled) return;
    onSubmit(v);
    setValue("");
    if (ref.current) ref.current.style.height = "auto";
  }

  return (
    <div className="flex gap-2 items-end border-t-2 border-black pt-3 mt-3">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          e.currentTarget.style.height = "auto";
          e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder ?? "Ask anything…"}
        rows={1}
        disabled={disabled}
        className="flex-1 resize-none rounded-feature border-2 border-black bg-white px-3 py-2 text-sm focus:outline-none disabled:opacity-50"
      />
      <button
        type="button"
        onClick={submit}
        disabled={disabled}
        className="rounded-pill bg-black text-cream w-10 h-10 flex items-center justify-center text-sm disabled:opacity-50"
        aria-label="Send"
      >
        →
      </button>
    </div>
  );
}
