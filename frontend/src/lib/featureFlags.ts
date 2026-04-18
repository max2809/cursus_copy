export function getCookie(name: string): string | null {
  const pairs = document.cookie.split(";").map((p) => p.trim().split("=", 2));
  for (const [k, v] of pairs) {
    if (k === name) return decodeURIComponent(v ?? "");
  }
  return null;
}

export function isChatFeatureEnabled(): boolean {
  return getCookie("sb_ff_chat") === "1";
}
