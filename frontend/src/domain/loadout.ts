import type {Selection, Solution} from "../types";

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

export function weaponTypeCount(solution: Solution): number {
  const selections = solution.selections;
  if (selections) {
    return new Set(selections.filter((item) => !item.support)
      .map((item) => item.weapon_id || item.weapon_display_name || item.option_id)).size;
  }
  return Object.keys(solution.weapon_counts || {}).length;
}

export function loadoutText(solution: Solution): string {
  const counts = Object.entries(solution.weapon_counts || {});
  if (counts.length) {
    return counts.sort(([left], [right]) => left.localeCompare(right, "zh-CN"))
      .map(([name, count]) => count === 1 ? name : `${name} ×${count}`).join(" · ");
  }
  return solution.selections?.length === 0 ? "无挂载" : "未读取挂载组合";
}

function selectionGroupKey(selection: Selection): string {
  return String(
    selection.weapon_id
      || selection.weapon_display_name
      || "unknown",
  );
}
