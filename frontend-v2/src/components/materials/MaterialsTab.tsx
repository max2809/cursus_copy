import { useEffect, useState } from "react";
import {
  addUrlMaterial,
  deleteMaterial,
  listMaterials,
  refreshMaterials,
  uploadMaterial,
} from "../../api/materials";
import type { MaterialItem } from "../../api/types";
import { MaterialsList } from "./MaterialsList";
import { AddMaterialModal } from "./AddMaterialModal";

interface Props {
  canvasCourseId: number;
  courseName: string;
}

export function MaterialsTab({ canvasCourseId, courseName }: Props) {
  const [items, setItems] = useState<MaterialItem[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function reload() {
    const r = await listMaterials(canvasCourseId);
    setItems(r.materials);
  }

  useEffect(() => {
    reload();
  }, [canvasCourseId]);

  useEffect(() => {
    const pending = items.some((m) => m.indexed_at === null && m.index_error === null);
    if (!pending) return;
    const id = setInterval(reload, 5000);
    return () => clearInterval(id);
  }, [items]);

  async function handleRefresh() {
    setBusy(true);
    try {
      const r = await refreshMaterials(canvasCourseId);
      setItems(r.materials);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-medium text-xl">Materials · {courseName}</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-pill border-2 border-black bg-matcha-200 px-3 py-1 text-sm"
          >
            + Add
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={busy}
            className="rounded-pill border-2 border-black bg-cream px-3 py-1 text-sm"
          >
            {busy ? "Refreshing…" : "↻"}
          </button>
        </div>
      </div>
      <MaterialsList
        items={items}
        onDelete={async (id) => {
          await deleteMaterial(canvasCourseId, id);
          await reload();
        }}
      />
      <AddMaterialModal
        open={open}
        onClose={() => setOpen(false)}
        onFile={async (f) => {
          await uploadMaterial(canvasCourseId, f);
          await reload();
        }}
        onUrl={async (u) => {
          await addUrlMaterial(canvasCourseId, u);
          await reload();
        }}
      />
    </div>
  );
}
