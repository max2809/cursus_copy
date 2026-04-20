export function formatDue(iso: string | null): string {
  if (!iso) return "No due date";
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function relativeTo(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  const days = Math.round(ms / 86_400_000);
  if (days < 0) return `${Math.abs(days)}d late`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 7) return `in ${days}d`;
  if (days < 14) return `in ${days}d`;
  return `in ${Math.round(days / 7)}w`;
}
