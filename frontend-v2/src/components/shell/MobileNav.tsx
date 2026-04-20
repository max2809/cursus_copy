import { IconChat, IconHome, IconLibrary, IconPlan } from "../../design/icons";
import type { NavKey } from "./Sidebar";

interface Props {
  active: NavKey;
  onNav: (n: NavKey) => void;
}

const ITEMS: { id: NavKey; label: string; Icon: (p: any) => JSX.Element }[] = [
  { id: "home", label: "Home", Icon: IconHome },
  { id: "chat", label: "Ask", Icon: IconChat },
  { id: "plan", label: "Plan", Icon: IconPlan },
  { id: "library", label: "Library", Icon: IconLibrary },
];

export function MobileNav({ active, onNav }: Props) {
  return (
    <nav className="mobile-nav">
      {ITEMS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          className="mobile-nav-item"
          data-active={active === id}
          onClick={() => onNav(id)}
        >
          <Icon />
          <span className="m-label">{label}</span>
        </button>
      ))}
    </nav>
  );
}
