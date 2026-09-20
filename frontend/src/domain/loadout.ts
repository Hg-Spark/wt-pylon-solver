import type {Selection, Solution} from "../types";

export interface GroupedSelection {
  key: string;
  name: string;
  totalCount: number;
  damage: number;
}

export function safeInteger(value: number, fallback: number, minimum: number): number {
  return Number.isInteger(Number(value)) && Number(value) >= minimum ? Number(value) : fallback;
}

export function solutionId(solution: Solution): string {
  const counts = new Map<string, number>();
  for (const selection of solution.selections || []) {
    const key = selectionGroupKey(selection);
    const count = Math.max(1, Number(selection.count || 1));
    counts.set(key, (counts.get(key) || 0) + count);
  }

  if (counts.size) {
    return `composition:${JSON.stringify(
      [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
    )}`;
  }

  return `composition:${loadoutText(solution)}`;
}

export function loadoutText(solution: Solution): string {
  return Object.entries(solution.weapon_counts || {})
    .map(([name, count]) => `${name} ×${count}`)
    .join(" · ") || "未读取挂载组合";
}

export function groupSolutionSelections(selections: Selection[] | undefined): GroupedSelection[] {
  const groups = new Map<string, GroupedSelection>();

  for (const selection of selections || []) {
    const key = selectionGroupKey(selection);
    const count = Math.max(1, Number(selection.count || 1));
    const damage = Number(selection.damage || 0);
    const existing = groups.get(key);
    if (existing) {
      existing.totalCount += count;
      existing.damage += damage;
      continue;
    }

    groups.set(key, {
      key,
      name: selectionName(selection),
      totalCount: count,
      damage,
    });
  }

  return [...groups.values()];
}

function selectionGroupKey(selection: Selection): string {
  return String(
    selection.weapon_id
      || selection.weapon_display_name
      || "unknown",
  );
}

function selectionName(selection: Selection): string {
  return selection.weapon_display_name || selection.weapon_id || "未知挂载";
}
