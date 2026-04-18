export type SubTabKey = "deadlines" | "chat" | "materials";

interface Props {
  active: SubTabKey;
  onChange: (next: SubTabKey) => void;
  chatEnabled: boolean;
}

export function CourseSubTabs({ active, onChange, chatEnabled }: Props) {
  const tabs: { key: SubTabKey; label: string }[] = [
    { key: "deadlines", label: "Deadlines" },
  ];
  if (chatEnabled) {
    tabs.push({ key: "chat", label: "Chat" });
    tabs.push({ key: "materials", label: "Materials" });
  }
  return (
    <div className="flex gap-2 flex-wrap mb-4">
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={
              "px-4 py-1.5 rounded-pill border-2 border-black text-sm font-medium transition " +
              (isActive
                ? "bg-black text-cream shadow-clay-hover"
                : "bg-oat-light text-black hover:shadow-clay-hover")
            }
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
