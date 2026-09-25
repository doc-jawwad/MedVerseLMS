import type { FolderLibraryType } from "@/lib/library/types";

export type FolderRow = {
  id: string;
  name: string;
  description: string | null;
  year_id: string | null;
  subject_id: string | null;
  parent_id: string | null;
  sort_order: number;
  entitlement: string;
  library_type: string;
};

export type MaterialRow = {
  id: string;
  folder_id: string;
  title: string;
  description: string | null;
  file_type: string | null;
  kind: string;
  status: string;
  r2_byte_size?: number | null;
};

export type FolderNode = FolderRow & {
  children: FolderNode[];
  materials: MaterialRow[];
};

/** Build a depth-limited tree (Past Papers: root → child). Orphans attach as roots. */
export function nestFolders(
  folders: FolderRow[],
  materials: MaterialRow[],
  libraryType: FolderLibraryType
): FolderNode[] {
  const typed = folders.filter((f) => f.library_type === libraryType);
  const byId = new Map<string, FolderNode>();
  for (const f of typed) {
    byId.set(f.id, {
      ...f,
      children: [],
      materials: [],
    });
  }
  for (const m of materials) {
    byId.get(m.folder_id)?.materials.push(m);
  }
  const roots: FolderNode[] = [];
  for (const node of byId.values()) {
    if (node.parent_id && byId.has(node.parent_id)) {
      byId.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortNodes = (nodes: FolderNode[]) => {
    nodes.sort(
      (a, b) =>
        a.sort_order - b.sort_order || a.name.localeCompare(b.name)
    );
    for (const n of nodes) {
      sortNodes(n.children);
      n.materials.sort((a, b) => a.title.localeCompare(b.title));
    }
  };
  sortNodes(roots);
  return roots;
}
