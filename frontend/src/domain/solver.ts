import type {
  BombingRewardProfile,
  FixedPylons,
  PreparedOption,
  PreparedPylon,
  QuantityConstraint,
  Selection,
  Solution,
  SortBy,
} from "../types";

export interface SolverInput {
  pylons: PreparedPylon[];
  targetDamage: number;
  rewardProfile: BombingRewardProfile | null;
  top: number;
  maxOverkill: number;
  sortBy: SortBy;
  allowedSlots: ReadonlySet<number>;
  allowedOptions: ReadonlySet<string> | null;
  damageOverrides: Readonly<Record<string, number>>;
  quantityConstraints: QuantityConstraint[];
  fixedPylons?: Readonly<FixedPylons>;
}

interface EffectiveOption {
  source: PreparedOption;
  optionId: string;
  damage: number;
  countedBaseDamage: number;
  count: number;
  weightKg: number;
}

interface Candidate {
  damage: number;
  countedBaseDamage: number;
  weightKg: number;
  weaponCount: number;
  selectionCount: number;
  constraintCounts: Record<string, number>;
  relationChoices: Record<number, string>;
  relationKey: string;
  reward?: number | null;
  previous?: Candidate;
  slot?: number;
  option?: EffectiveOption;
}

interface Relations {
  byId: Map<string, EffectiveOption>;
  slots: Map<string, number>;
  relevant: Set<string>;
}

interface ConstraintTarget {
  key: string;
  count: number;
  mode: "exact" | "at_least";
  countBy: "selection" | "weapon";
}

interface ConstraintSet {
  targets: Map<string, ConstraintTarget>;
  byOption: Map<string, ConstraintTarget[]>;
}

export function solvePylonLoadout(input: SolverInput): Solution[] {
  const constraints = buildConstraints(input.quantityConstraints);
  const constraintKeys = [...constraints.targets.keys()].sort();
  const resultLimit = Math.max(1, Math.trunc(input.top));
  const fixed = input.fixedPylons || {};
  const availableSlots = new Set(input.pylons.map((pylon) => pylon.slot));
  for (const key of Object.keys(fixed)) {
    const slot = Number(key);
    if (!availableSlots.has(slot)) return [];
    const optionId = fixed[slot];
    // A station already excluded by the global limit may also be pinned empty.
    if (optionId !== null && input.allowedSlots.size > 0 && !input.allowedSlots.has(slot)) return [];
    if (optionId != null && !input.pylons.find((pylon) => pylon.slot === slot)?.options
      .some((option) => option.option_id === optionId)) return [];
  }
  const activePylons = input.pylons.filter((pylon) => (
    input.allowedSlots.size === 0 || input.allowedSlots.has(pylon.slot)
  )).sort((a, b) => a.slot - b.slot);
  const optionsBySlot = activePylons.map((pylon) => pylon.options
    .filter((option) => !Object.prototype.hasOwnProperty.call(fixed, pylon.slot)
      || option.option_id === fixed[pylon.slot])
    .map((option) => normalizeOption(option, input, fixed[pylon.slot] === option.option_id))
    .filter((option): option is EffectiveOption => option !== null));
  const relations = buildRelations(activePylons, optionsBySlot);

  let maxOptionDamage = 0;
  const maxDamageBySlot = optionsBySlot.map((options) => {
    let slotMax = 0;
    for (const option of options) {
      if (option.damage > slotMax) slotMax = option.damage;
      if (option.damage > maxOptionDamage) maxOptionDamage = option.damage;
    }
    return slotMax;
  });

  const targetDamage = Math.max(1, Math.trunc(input.targetDamage));
  const searchLimit = targetDamage + Math.max(0, Math.trunc(input.maxOverkill ?? maxOptionDamage));
  const suffixMaxDamage = buildSuffixMaxDamage(maxDamageBySlot);
  const initialCounts: Record<string, number> = {};
  for (const key of constraintKeys) initialCounts[key] = 0;

  const initial: Candidate = {
    damage: 0,
    countedBaseDamage: 0,
    weightKg: 0,
    weaponCount: 0,
    selectionCount: 0,
    constraintCounts: initialCounts,
    relationChoices: {},
    relationKey: "",
  };

  const finalCandidates = constraints.targets.size === 0
    ? solveUnconstrained(
      initial,
      activePylons,
      optionsBySlot,
      suffixMaxDamage,
      targetDamage,
      searchLimit,
      input.sortBy,
      resultLimit,
      relations,
      fixed,
    )
    : solveConstrained(
      initial,
      activePylons,
      optionsBySlot,
      suffixMaxDamage,
      targetDamage,
      searchLimit,
      constraints,
      constraintKeys,
      input.sortBy,
      resultLimit,
      relations,
      fixed,
    );

  const solutions = filterDominatedSolutions(
    finalCandidates.filter((candidate) => supportsAreRequired(candidate, fixed)),
    targetDamage,
    input.sortBy,
    input.rewardProfile,
  );
  solutions.sort((left, right) => compareSolutionScore(
    left,
    right,
    targetDamage,
    input.sortBy,
    input.rewardProfile,
  ));

  const unique = new Map<string, Candidate>();
  for (const candidate of solutions) {
    const signature = solutionSignature(candidate);
    if (!unique.has(signature)) unique.set(signature, candidate);
  }

  return [...unique.values()]
    .slice(0, resultLimit)
    .map((candidate) => formatSolution(candidate, targetDamage, input.rewardProfile));
}

function buildRelations(pylons: PreparedPylon[], optionsBySlot: EffectiveOption[][]): Relations {
  const byId = new Map<string, EffectiveOption>();
  const slots = new Map<string, number>();
  const relevant = new Set<string>();
  for (let i = 0; i < pylons.length; i++) {
    for (const option of optionsBySlot[i]) {
      byId.set(option.optionId, option);
      slots.set(option.optionId, pylons[i].slot);
    }
  }
  // Only relations between currently available options affect DP state identity.
  for (const option of byId.values()) {
    const required = option.source.required_option_ids || [];
    const banned = option.source.banned_option_ids || [];
    for (const id of [...required, ...banned]) {
      if (!byId.has(id)) continue;
      relevant.add(option.optionId);
      relevant.add(id);
    }
  }
  return {byId, slots, relevant};
}

function isCompatible(
  candidate: Candidate,
  slot: number,
  option: EffectiveOption | null,
  relations: Relations,
): boolean {
  const id = option?.optionId;
  for (const priorId of Object.values(candidate.relationChoices)) {
    const prior = relations.byId.get(priorId);
    if (prior?.source.required_option_ids?.some((requiredId) =>
      relations.slots.get(requiredId) === slot && requiredId !== id)) return false;
    if (id && (prior?.source.banned_option_ids?.includes(id)
      || option?.source.banned_option_ids?.includes(priorId))) return false;
  }
  if (!option) return true;
  for (const requiredId of option.source.required_option_ids || []) {
    const requiredSlot = relations.slots.get(requiredId);
    if (requiredSlot == null) return false;
    if (requiredSlot === slot && requiredId !== id) return false;
    if (requiredSlot < slot && candidate.relationChoices[requiredSlot] !== requiredId) return false;
  }
  return true;
}

function supportsAreRequired(candidate: Candidate, fixed: Readonly<FixedPylons>): boolean {
  const used = new Set<string>();
  const required = new Set<string>();
  for (let current: Candidate | undefined = candidate; current; current = current.previous) {
    if (!current.option) continue;
    if (current.option.source.support && fixed[current.slot ?? -1] !== current.option.optionId) {
      used.add(current.option.optionId);
    }
    for (const id of current.option.source.required_option_ids || []) required.add(id);
  }
  return [...used].every((id) => required.has(id));
}

function buildConstraints(quantityConstraints: QuantityConstraint[]): ConstraintSet {
  const targets = new Map<string, ConstraintTarget>();
  const byOption = new Map<string, ConstraintTarget[]>();

  for (const constraint of quantityConstraints) {
    if (constraint.count < 1 || constraint.count > 64) continue;
    const optionIds = constraint.option_ids?.length
      ? constraint.option_ids.map(String)
      : constraint.option_id
        ? [String(constraint.option_id)]
        : [];
    if (!optionIds.length) continue;

    const key = String(constraint.constraint_id || constraint.option_id || optionIds.join("|"));
    const target: ConstraintTarget = {
      key,
      count: constraint.count,
      mode: constraint.mode,
      countBy: constraint.count_by === "weapon" ? "weapon" : "selection",
    };
    targets.set(key, target);

    for (const optionId of optionIds) {
      const bucket = byOption.get(optionId);
      if (bucket) bucket.push(target);
      else byOption.set(optionId, [target]);
    }
  }

  return {targets, byOption};
}

function buildSuffixMaxDamage(maxDamageBySlot: number[]): number[] {
  const suffix = new Array<number>(maxDamageBySlot.length + 1).fill(0);
  for (let index = maxDamageBySlot.length - 1; index >= 0; index -= 1) {
    suffix[index] = suffix[index + 1] + maxDamageBySlot[index];
  }
  return suffix;
}

function solveUnconstrained(
  initial: Candidate,
  activePylons: PreparedPylon[],
  optionsBySlot: EffectiveOption[][],
  suffixMaxDamage: number[],
  targetDamage: number,
  searchLimit: number,
  sortBy: SortBy,
  stateLimit: number,
  relations: Relations,
  fixed: Readonly<FixedPylons>,
): Candidate[] {
  let states = new Map<string, Candidate[]>();
  states.set(stateKeyForSort(0, 0, sortBy, ""), [initial]);

  for (let index = 0; index < activePylons.length; index += 1) {
    const pylon = activePylons[index];
    const options = optionsBySlot[index];
    const remainingMaxDamage = suffixMaxDamage[index + 1];
    const nextStates = new Map<string, Candidate[]>();

    // Preserve the original DP insertion order: carry all viable states first,
    // then append states created by using the current pylon. Stable ordering is
    // relevant when otherwise-equal candidates reach the Top-N cutoff.
    for (const [key, candidates] of states) {
      const stateDamage = candidates[0]?.damage ?? 0;
      if ((!Object.prototype.hasOwnProperty.call(fixed, pylon.slot) || fixed[pylon.slot] === null)
        && (stateDamage >= targetDamage || stateDamage + remainingMaxDamage >= targetDamage)) {
        const compatible = candidates.filter((candidate) => isCompatible(candidate, pylon.slot, null, relations));
        if (compatible.length) nextStates.set(key, compatible);
      }
    }

    for (const candidates of states.values()) {
      for (const candidate of candidates) {
        for (const option of options) {
          if (!isCompatible(candidate, pylon.slot, option, relations)) continue;
          const damage = candidate.damage + option.damage;
          if (damage > searchLimit) continue;
          if (damage < targetDamage && damage + remainingMaxDamage < targetDamage) continue;

          const nextCandidate = extendCandidate(candidate, pylon.slot, option, candidate.constraintCounts, relations);
          const nextKey = stateKeyForSort(damage, nextCandidate.countedBaseDamage, sortBy, nextCandidate.relationKey);
          nextStates.set(
            nextKey,
            insertStateCandidate(
              nextStates.get(nextKey) || [],
              nextCandidate,
              sortBy,
              stateLimit,
            ),
          );
        }
      }
    }
    states = nextStates;
  }

  const result: Candidate[] = [];
  for (const candidates of states.values()) {
    for (const candidate of candidates) {
      if (candidate.damage >= targetDamage) result.push(candidate);
    }
  }
  return result;
}

function solveConstrained(
  initial: Candidate,
  activePylons: PreparedPylon[],
  optionsBySlot: EffectiveOption[][],
  suffixMaxDamage: number[],
  targetDamage: number,
  searchLimit: number,
  constraints: ConstraintSet,
  constraintKeys: string[],
  sortBy: SortBy,
  stateLimit: number,
  relations: Relations,
  fixed: Readonly<FixedPylons>,
): Candidate[] {
  let states = new Map<string, Candidate[]>();
  states.set(stateKey(0, 0, initial.constraintCounts, constraintKeys, sortBy, ""), [initial]);

  for (let index = 0; index < activePylons.length; index += 1) {
    const pylon = activePylons[index];
    const options = optionsBySlot[index];
    const remainingMaxDamage = suffixMaxDamage[index + 1];
    const nextStates = new Map<string, Candidate[]>();

    for (const [key, candidates] of states) {
      const stateDamage = candidates[0]?.damage ?? 0;
      if ((!Object.prototype.hasOwnProperty.call(fixed, pylon.slot) || fixed[pylon.slot] === null)
        && (stateDamage >= targetDamage || stateDamage + remainingMaxDamage >= targetDamage)) {
        const compatible = candidates.filter((candidate) => isCompatible(candidate, pylon.slot, null, relations));
        if (compatible.length) nextStates.set(key, compatible);
      }
    }

    for (const candidates of states.values()) {
      for (const candidate of candidates) {
        for (const option of options) {
          if (!isCompatible(candidate, pylon.slot, option, relations)) continue;
          const nextCounts = fixed[pylon.slot] === option.optionId
            ? candidate.constraintCounts
            : nextConstraintCounts(candidate.constraintCounts, option, constraints);
          if (!nextCounts) continue;

          const damage = candidate.damage + option.damage;
          if (damage > searchLimit) continue;
          if (damage < targetDamage && damage + remainingMaxDamage < targetDamage) continue;

          const nextCandidate = extendCandidate(candidate, pylon.slot, option, nextCounts, relations);
          const nextKey = stateKey(
            damage,
            nextCandidate.countedBaseDamage,
            nextCounts,
            constraintKeys,
            sortBy,
            nextCandidate.relationKey,
          );
          nextStates.set(
            nextKey,
            insertStateCandidate(
              nextStates.get(nextKey) || [],
              nextCandidate,
              sortBy,
              stateLimit,
            ),
          );
        }
      }
    }
    states = nextStates;
  }

  const result: Candidate[] = [];
  for (const candidates of states.values()) {
    for (const candidate of candidates) {
      if (candidate.damage >= targetDamage && constraintsSatisfied(candidate.constraintCounts, constraints.targets)) {
        result.push(candidate);
      }
    }
  }
  return result;
}

function extendCandidate(
  candidate: Candidate,
  slot: number,
  option: EffectiveOption,
  constraintCounts: Record<string, number>,
  relations: Relations,
): Candidate {
  const related = relations.relevant.has(option.optionId);
  return {
    relationChoices: related
      ? {...candidate.relationChoices, [slot]: option.optionId}
      : candidate.relationChoices,
    relationKey: related ? `${candidate.relationKey}|${slot}:${option.optionId}` : candidate.relationKey,
    damage: candidate.damage + option.damage,
    countedBaseDamage: candidate.countedBaseDamage + option.countedBaseDamage,
    weightKg: candidate.weightKg + option.weightKg,
    weaponCount: candidate.weaponCount + option.count,
    selectionCount: candidate.selectionCount + 1,
    constraintCounts,
    previous: candidate,
    slot,
    option,
  };
}

function normalizeOption(source: PreparedOption, input: SolverInput, fixed = false): EffectiveOption | null {
  const optionId = String(source.option_id || "");
  if (!optionId) return null;
  if (input.allowedOptions && !input.allowedOptions.has(optionId) && !source.support && !fixed) return null;

  const hasOverride = Object.prototype.hasOwnProperty.call(input.damageOverrides, optionId);
  const damage = hasOverride ? input.damageOverrides[optionId] : source.damage;
  if (damage == null || !Number.isFinite(damage)) {
    if (!fixed) return null;
  } else if (damage <= 0 && !source.support && !fixed) {
    return null;
  }

  const countedBaseDamage = source.counted_base_damage;

  return {
    source,
    optionId,
    // A pinned non-bombing store must occupy its station even with no base damage.
    damage: damage != null && Number.isFinite(damage) ? Math.max(0, Number(damage)) : 0,
    countedBaseDamage: Math.max(0, Number(countedBaseDamage)),
    count: source.count,
    weightKg: source.weight_kg,
  };
}

function nextConstraintCounts(
  current: Record<string, number>,
  option: EffectiveOption,
  constraints: ConstraintSet,
): Record<string, number> | null {
  const targets = constraints.byOption.get(option.optionId);
  if (!targets?.length) return current;

  let next: Record<string, number> | null = null;
  for (const target of targets) {
    const increment = target.countBy === "weapon" ? Math.max(option.count, 1) : 1;
    const nextCount = (current[target.key] || 0) + increment;
    if (target.mode === "exact" && nextCount > target.count) return null;
    if (!next) next = {...current};
    next[target.key] = Math.min(nextCount, target.count);
  }
  return next || current;
}

function constraintsSatisfied(
  current: Record<string, number>,
  constraints: Map<string, ConstraintTarget>,
): boolean {
  for (const [key, target] of constraints) {
    const count = current[key] || 0;
    if (target.mode === "exact" ? count !== target.count : count < target.count) return false;
  }
  return true;
}

function stateKeyForSort(damage: number, countedBaseDamage: number, sortBy: SortBy, relationKey: string): string {
  const base = sortBy === "high_yield" ? `${damage}|${countedBaseDamage}` : String(damage);
  return `${base}|${relationKey}`;
}

function stateKey(
  damage: number,
  countedBaseDamage: number,
  counts: Record<string, number>,
  constraintKeys: string[],
  sortBy: SortBy,
  relationKey: string,
): string {
  let key = `${stateKeyForSort(damage, countedBaseDamage, sortBy, relationKey)}|`;
  for (let index = 0; index < constraintKeys.length; index += 1) {
    if (index > 0) key += ",";
    const constraintKey = constraintKeys[index];
    key += `${constraintKey}:${counts[constraintKey] || 0}`;
  }
  return key;
}

function insertStateCandidate(
  candidates: Candidate[],
  candidate: Candidate,
  sortBy: SortBy,
  stateLimit: number,
): Candidate[] {
  for (const existing of candidates) {
    if (dominatesState(existing, candidate)) return candidates;
  }

  const kept: Candidate[] = [];
  for (const existing of candidates) {
    if (!dominatesState(candidate, existing)) kept.push(existing);
  }

  let insertAt = kept.length;
  for (let index = 0; index < kept.length; index += 1) {
    if (compareStateCandidate(candidate, kept[index], sortBy) < 0) {
      insertAt = index;
      break;
    }
  }
  kept.splice(insertAt, 0, candidate);
  if (kept.length > stateLimit) kept.length = stateLimit;
  return kept;
}

function dominatesState(left: Candidate, right: Candidate): boolean {
  return left.selectionCount <= right.selectionCount
    && left.weightKg <= right.weightKg
    && left.weaponCount <= right.weaponCount
    && (
      left.selectionCount < right.selectionCount
      || left.weightKg < right.weightKg
      || left.weaponCount < right.weaponCount
    );
}

function compareStateCandidate(
  left: Candidate,
  right: Candidate,
  sortBy: SortBy,
): number {
  let difference: number;

  if (sortBy === "high_yield") {
    // Actual damage and display damage are both part of the state key, so reward
    // and overkill are identical inside this bucket. Only final tie-breakers
    // are needed, and no reward formula is evaluated during DP.
    difference = left.selectionCount - right.selectionCount;
    if (difference !== 0) return difference;
    difference = left.weightKg - right.weightKg;
    if (difference !== 0) return difference;
    return left.weaponCount - right.weaponCount;
  }

  if (sortBy === "weight") {
    difference = left.weightKg - right.weightKg;
    if (difference !== 0) return difference;
    difference = left.weaponCount - right.weaponCount;
    if (difference !== 0) return difference;
    return left.selectionCount - right.selectionCount;
  }

  difference = left.selectionCount - right.selectionCount;
  if (difference !== 0) return difference;
  difference = left.weightKg - right.weightKg;
  if (difference !== 0) return difference;
  return left.weaponCount - right.weaponCount;
}

function filterDominatedSolutions(
  candidates: Candidate[],
  targetDamage: number,
  sortBy: SortBy,
  rewardProfile: BombingRewardProfile | null,
): Candidate[] {
  const ordered = [...candidates];
  ordered.sort((left, right) => compareSolutionDominance(
    left,
    right,
    targetDamage,
    sortBy,
    rewardProfile,
  ));

  const filtered: Candidate[] = [];
  for (const candidate of ordered) {
    let dominated = false;
    for (const existing of filtered) {
      if (dominatesSolution(existing, candidate, targetDamage, sortBy, rewardProfile)) {
        dominated = true;
        break;
      }
    }
    if (dominated) continue;

    let writeIndex = 0;
    for (let readIndex = 0; readIndex < filtered.length; readIndex += 1) {
      const existing = filtered[readIndex];
      if (!dominatesSolution(candidate, existing, targetDamage, sortBy, rewardProfile)) {
        filtered[writeIndex] = existing;
        writeIndex += 1;
      }
    }
    filtered.length = writeIndex;
    filtered.push(candidate);
  }
  return filtered;
}

function dominatesSolution(
  left: Candidate,
  right: Candidate,
  targetDamage: number,
  sortBy: SortBy,
  rewardProfile: BombingRewardProfile | null,
): boolean {
  const leftOverkill = left.damage - targetDamage;
  const rightOverkill = right.damage - targetDamage;

  if (sortBy === "high_yield") {
    const leftReward = candidateReward(left, rewardProfile);
    const rightReward = candidateReward(right, rewardProfile);
    if (leftReward == null || rightReward == null) return false;
    return leftReward >= rightReward
      && leftOverkill <= rightOverkill
      && left.selectionCount <= right.selectionCount
      && left.weightKg <= right.weightKg
      && left.weaponCount <= right.weaponCount
      && (
        leftReward > rightReward
        || leftOverkill < rightOverkill
        || left.selectionCount < right.selectionCount
        || left.weightKg < right.weightKg
        || left.weaponCount < right.weaponCount
      );
  }

  return left.selectionCount <= right.selectionCount
    && leftOverkill <= rightOverkill
    && left.weightKg <= right.weightKg
    && left.weaponCount <= right.weaponCount
    && (
      left.selectionCount < right.selectionCount
      || leftOverkill < rightOverkill
      || left.weightKg < right.weightKg
      || left.weaponCount < right.weaponCount
    );
}

function compareSolutionDominance(
  left: Candidate,
  right: Candidate,
  targetDamage: number,
  sortBy: SortBy,
  rewardProfile: BombingRewardProfile | null,
): number {
  if (sortBy === "high_yield") {
    const difference = compareRewardDescending(left, right, rewardProfile);
    if (difference !== 0) return difference;
  }

  let difference = left.selectionCount - right.selectionCount;
  if (difference !== 0) return difference;
  difference = (left.damage - targetDamage) - (right.damage - targetDamage);
  if (difference !== 0) return difference;
  difference = left.weightKg - right.weightKg;
  if (difference !== 0) return difference;
  return left.weaponCount - right.weaponCount;
}

function compareSolutionScore(
  left: Candidate,
  right: Candidate,
  targetDamage: number,
  sortBy: SortBy,
  rewardProfile: BombingRewardProfile | null,
): number {
  const leftOverkill = left.damage - targetDamage;
  const rightOverkill = right.damage - targetDamage;

  if (sortBy === "weapons") {
    let difference = left.selectionCount - right.selectionCount;
    if (difference !== 0) return difference;
    difference = leftOverkill - rightOverkill;
    if (difference !== 0) return difference;
    difference = left.weightKg - right.weightKg;
    if (difference !== 0) return difference;
    return left.weaponCount - right.weaponCount;
  }

  if (sortBy === "weight") {
    let difference = left.weightKg - right.weightKg;
    if (difference !== 0) return difference;
    difference = left.weaponCount - right.weaponCount;
    if (difference !== 0) return difference;
    difference = leftOverkill - rightOverkill;
    if (difference !== 0) return difference;
    return left.selectionCount - right.selectionCount;
  }

  let difference = compareRewardDescending(left, right, rewardProfile);
  if (difference !== 0) return difference;
  difference = left.selectionCount - right.selectionCount;
  if (difference !== 0) return difference;
  difference = left.weightKg - right.weightKg;
  if (difference !== 0) return difference;
  difference = leftOverkill - rightOverkill;
  if (difference !== 0) return difference;
  return left.weaponCount - right.weaponCount;
}

function compareRewardDescending(
  left: Candidate,
  right: Candidate,
  rewardProfile: BombingRewardProfile | null,
): number {
  const leftReward = candidateReward(left, rewardProfile);
  const rightReward = candidateReward(right, rewardProfile);
  if (leftReward == null) return rightReward == null ? 0 : 1;
  if (rightReward == null) return -1;
  return rightReward - leftReward;
}

function candidateReward(
  candidate: Candidate,
  rewardProfile: BombingRewardProfile | null,
): number | null {
  if (candidate.reward !== undefined) return candidate.reward;
  candidate.reward = calculateReward(candidate.countedBaseDamage, rewardProfile);
  return candidate.reward;
}

export function calculateReward(
  damage: number,
  profile: BombingRewardProfile | null,
): number | null {
  if (!profile || damage <= 0) return null;

  const curve = profile.piecewise_linear_table;
  if (curve.length && damage >= curve[0][0]) {
    if (damage >= curve[curve.length - 1][0]) return 10 * curve[curve.length - 1][1];
    for (let index = 1; index < curve.length; index += 1) {
      if (damage <= curve[index][0]) {
        const [x0, y0] = curve[index - 1];
        const [x1, y1] = curve[index];
        return 10 * (y0 + (y1 - y0) * (damage - x0) / (x1 - x0));
      }
    }
  }

  return 10 * Math.min(
    (profile.is_premium ? profile.prem_bombing_reward_mul : 1)
      * (profile.low_reward_constant + profile.low_reward_inverse_damage / damage),
    1,
  ) * (profile.is_fighter ? profile.fighter_bombing_reward_mul : 1);
}

function toSelection(option: EffectiveOption, slot: number): Selection {
  return {
    option_id: option.optionId,
    slot,
    support: option.source.support || undefined,
    weapon_id: option.source.weapon_id,
    weapon_display_name: option.source.displayName,
    count: option.count,
    damage: option.damage,
  };
}

function solutionSignature(candidate: Candidate): string {
  const counts = new Map<string, number>();
  let current: Candidate | undefined = candidate;
  while (current) {
    if (current.option) {
      const source = current.option.source;
      const key = String(source.weapon_id || source.displayName || current.option.optionId);
      counts.set(key, (counts.get(key) || 0) + Math.max(1, current.option.count));
    }
    current = current.previous;
  }

  return JSON.stringify(
    [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function formatSolution(
  candidate: Candidate,
  targetDamage: number,
  rewardProfile: BombingRewardProfile | null,
): Solution {
  const selected = selections(candidate);
  const weaponCounts: Record<string, number> = {};
  for (const selection of selected) {
    const name = selection.weapon_display_name || selection.weapon_id || "未知挂载";
    weaponCounts[name] = (weaponCounts[name] || 0) + Number(selection.count || 1);
  }
  return {
    damage: candidate.damage,
    counted_base_damage: candidate.countedBaseDamage,
    overkill: candidate.damage - targetDamage,
    reward: candidateReward(candidate, rewardProfile),
    total_weight_kg: Math.round(candidate.weightKg * 10) / 10,
    slot_count: candidate.selectionCount,
    weapon_count: candidate.weaponCount,
    weapon_counts: weaponCounts,
    selections: selected,
  };
}

function selections(candidate: Candidate): Selection[] {
  const result: Selection[] = [];
  let current: Candidate | undefined = candidate;
  while (current) {
    if (current.option && current.slot != null) result.push(toSelection(current.option, current.slot));
    current = current.previous;
  }
  return result.reverse();
}
