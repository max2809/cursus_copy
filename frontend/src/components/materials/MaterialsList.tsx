import type { MaterialItem } from "../../api/types";
import { MaterialRow } from "./MaterialRow";

interface Props {
  items: MaterialItem[];
  onDelete: (id: string) => void;
}

export function MaterialsList({ items, onDelete }: Props) {
  const canvas = items.filter((m) => m.source === "canvas");
  const user = items.filter((m) => m.source !== "canvas");
  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-xs uppercase tracking-wider font-medium opacity-60 mb-1">
          From Canvas · {canvas.length} file{canvas.length === 1 ? "" : "s"}
        </h3>
        {canvas.length === 0 ? (
          <p className="text-sm opacity-60">No Canvas materials synced.</p>
        ) : (
          canvas.map((m) => <MaterialRow key={m.id} item={m} />)
        )}
      </section>
      <section>
        <h3 className="text-xs uppercase tracking-wider font-medium opacity-60 mb-1">
          Your uploads · {user.length} item{user.length === 1 ? "" : "s"}
        </h3>
        {user.length === 0 ? (
          <p className="text-sm opacity-60">Nothing uploaded yet.</p>
        ) : (
          user.map((m) => <MaterialRow key={m.id} item={m} onDelete={() => onDelete(m.id)} />)
        )}
      </section>
    </div>
  );
}
