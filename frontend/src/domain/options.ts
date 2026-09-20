import type {
  ApiOption,
  ApiPylon,
  OptionGroup,
  OptionRow,
  OptionSubgroup,
  PreparedOption,
  PreparedPylon,
} from "../types";

export function prepareOption(option: ApiOption): PreparedOption {
  const category = option.weapon_category || "other";
  const subcategory = option.weapon_subcategory || null;
  const count = toPositiveInteger(option.count, 1);
  const damage = toNullableNumber(option.damage);
  const countedBaseDamage = toNonNegativeNumber(option.counted_base_damage, 0);
  const weightKg = toNonNegativeNumber(option.weight_kg, 0);

  return {
    ...option,
    count,
    damage,
    counted_base_damage: countedBaseDamage,
    weight_kg: weightKg,
    category,
    categoryLabel: categoryLabel(category),
    subcategory,
    subcategoryLabel: subcategoryLabel(subcategory),
    displayName: option.weapon_display_name || option.weapon_id || "",
  };
}

export function preparePylons(pylons: ApiPylon[], options: PreparedOption[]): PreparedPylon[] {
  const optionById = new Map(options.map((option) => [option.option_id, option]));
  return pylons
    .map((pylon) => ({
      slot: Number(pylon.slot),
      options: (pylon.option_ids || [])
        .map((optionId) => optionById.get(optionId))
        .filter((option): option is PreparedOption => Boolean(option)),
    }))
    .filter((pylon) => Number.isInteger(pylon.slot) && pylon.slot > 0);
}

export function buildOptionRows(options: PreparedOption[]): OptionRow[] {
  const groups = new Map<string, PreparedOption[]>();

  for (const option of options) {
    const key = logicalOptionKey(option);
    const bucket = groups.get(key);
    if (bucket) bucket.push(option);
    else groups.set(key, [option]);
  }

  return [...groups.entries()].map(([id, variants]) => {
    const sorted = [...variants].sort((left, right) => left.count - right.count || left.option_id.localeCompare(right.option_id));
    const option = sorted[0];
    const label = option.displayName || option.weapon_id || option.option_id;
    return {
      id,
      category: option.category,
      categoryLabel: option.categoryLabel,
      subcategory: option.subcategory,
      subcategoryLabel: option.subcategoryLabel,
      label,
      option,
      options: sorted,
      optionIds: sorted.map((item) => item.option_id),
      hasZeroDisplayDamage: sorted.some((item) => Number(item.damage || 0) > 0 && item.counted_base_damage === 0),
    } satisfies OptionRow;
  });
}

function logicalOptionKey(option: PreparedOption): string {
  const weaponIdentity = option.weapon_id || option.displayName || option.option_id;
  return `weapon:${weaponIdentity}`;
}

export function groupRows(rows: OptionRow[]): OptionGroup[] {
  const groups = new Map<string, OptionGroup>();

  for (const row of rows) {
    const category = row.category || "other";
    const groupKey = `category:${category}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = {
        key: groupKey,
        category,
        label: row.categoryLabel || categoryLabel(category),
        rows: [],
        subgroups: [],
      };
      groups.set(groupKey, group);
    }
    group.rows.push(row);

    const subcategory = row.subcategory || null;
    const subgroupKey = subcategory ? `subcategory:${category}:${subcategory}` : `items:${category}`;
    let subgroup = group.subgroups.find((item) => item.key === subgroupKey);
    if (!subgroup) {
      subgroup = {
        key: subgroupKey,
        subcategory,
        label: row.subcategoryLabel || row.categoryLabel || categoryLabel(category),
        rows: [],
      } satisfies OptionSubgroup;
      group.subgroups.push(subgroup);
    }
    subgroup.rows.push(row);
  }

  for (const group of groups.values()) {
    group.subgroups.sort(
      (left, right) => subcategoryOrder(group.category, left.subcategory) - subcategoryOrder(group.category, right.subcategory)
        || left.label.localeCompare(right.label, "zh-CN"),
    );
  }

  return [...groups.values()].sort(
    (left, right) => categoryOrder(left.category) - categoryOrder(right.category)
      || left.label.localeCompare(right.label, "zh-CN"),
  );
}

export function categoryLabel(category: string): string {
  return {
    missile: "导弹",
    bomb: "炸弹",
    rocket: "火箭弹",
    other: "其他",
  }[String(category || "")] || "其他";
}

export function subcategoryLabel(subcategory: string | null | undefined): string | null {
  if (!subcategory) return null;
  return {
    air_to_air: "空空导弹",
    air_to_ground: "空地导弹",
    anti_radiation: "反辐射导弹",
    anti_ship: "反舰导弹",
    general_bomb: "普通炸弹",
    guided_bomb: "制导炸弹",
    high_drag_bomb: "高阻炸弹",
    other_bomb: "其他炸弹",
  }[String(subcategory)] || null;
}

function categoryOrder(category: string): number {
  const order = ["missile", "bomb", "rocket", "other"];
  const index = order.indexOf(category);
  return index === -1 ? order.length : index;
}

function subcategoryOrder(category: string, subcategory: string | null): number {
  const order: Array<string | null> = category === "missile"
    ? ["air_to_air", "air_to_ground", "anti_radiation", "anti_ship"]
    : category === "bomb"
      ? ["general_bomb", "guided_bomb", "high_drag_bomb", "other_bomb"]
      : [null];
  const index = order.indexOf(subcategory);
  return index === -1 ? order.length : index;
}

function toNullableNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNonNegativeNumber(value: number | string | null | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function toPositiveInteger(value: number | string | null | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}
