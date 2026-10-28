export interface AircraftIndexItem {
  id: string;
  zh: string;
  en: string;
}

export type SortBy = "high_yield" | "weapons" | "weight";
export type QuantityMode = "exact" | "at_least";

export interface BombingRewardProfile {
  is_fighter: boolean;
  is_premium: boolean;
  fighter_bombing_reward_mul: number;
  prem_bombing_reward_mul: number;
  low_reward_constant: number;
  low_reward_inverse_damage: number;
  piecewise_linear_table: Array<[number, number]>;
}

export interface ApiOption {
  option_id: string;
  weapon_id: string;
  weapon_display_name: string;
  count?: number | string | null;
  weapon_category?: string | null;
  weapon_subcategory?: string | null;
  damage?: number | string | null;
  counted_base_damage?: number | string | null;
  weight_kg?: number | string | null;
  icon_type?: string;
  required_option_ids?: string[];
  banned_option_ids?: string[];
  support?: boolean;
}

export interface PreparedOption extends Omit<
  ApiOption,
  "count" | "damage" | "counted_base_damage" | "weight_kg"
> {
  count: number;
  damage: number | null;
  counted_base_damage: number;
  weight_kg: number;
  weight_known: boolean;
  category: string;
  categoryLabel: string;
  subcategory: string | null;
  subcategoryLabel: string | null;
  displayName: string;
}

export interface OptionRow {
  id: string;
  category: string;
  categoryLabel: string;
  subcategory: string | null;
  subcategoryLabel: string | null;
  label: string;
  option: PreparedOption;
  options: PreparedOption[];
  optionIds: string[];
  hasZeroDisplayDamage: boolean;
}

export interface OptionSubgroup {
  key: string;
  subcategory: string | null;
  label: string;
  rows: OptionRow[];
}

export interface OptionGroup {
  key: string;
  category: string;
  label: string;
  rows: OptionRow[];
  subgroups: OptionSubgroup[];
}

export interface OptionsResponse {
  reward_profile?: BombingRewardProfile | null;
  options: ApiOption[];
  pylons: ApiPylon[];
}

export interface ApiPylon {
  slot: number | string;
  option_ids: string[];
}

export interface PreparedPylon {
  slot: number;
  options: PreparedOption[];
}

/** Missing slot = freely optimized; null = forcibly empty; string = exact preset. */
export type FixedPylons = Record<number, string | null>;

export interface QuantityConstraint {
  option_id?: string;
  option_ids?: string[];
  constraint_id?: string;
  count_by?: "selection" | "weapon";
  count: number;
  mode: QuantityMode;
}

export interface Selection {
  option_id: string;
  slot: number;
  support?: boolean;
  weapon_id: string;
  weapon_display_name: string;
  count: number;
  damage: number;
}

export interface Solution {
  damage?: number | null;
  counted_base_damage?: number | null;
  overkill?: number | null;
  reward?: number | null;
  total_weight_kg?: number | null;
  slot_count?: number | null;
  weapon_count?: number | null;
  weapon_counts?: Record<string, number>;
  selections?: Selection[];
}

export interface SolveResult {
  aircraft: string;
  target_damage: number;
  reward_profile?: BombingRewardProfile | null;
  damage_overrides?: Record<string, number>;
  quantity_constraints?: QuantityConstraint[];
  solutions: Solution[];
  elapsed_ms: number;
}
