import {computed, ref, watch} from "vue";
import {defineStore} from "pinia";
import {releaseProxy, wrap, type Remote} from "comlink";
import type {SolverWorkerApi} from "../domain/solver.worker";
import {fetchOptions} from "../services/api";
import {readRecentAircraft} from "../domain/aircraft";
import {
  buildOptionRows,
  groupRows,
  prepareOption,
  preparePylons,
} from "../domain/options";
import {safeInteger} from "../domain/loadout";
import {calculateReward} from "../domain/solver";
import type {SolverInput} from "../domain/solver";
import type {
  BombingRewardProfile,
  FixedPylons,
  OptionGroup,
  OptionRow,
  PreparedOption,
  PreparedPylon,
  QuantityConstraint,
  QuantityMode,
  Solution,
  SolveResult,
  SortBy,
} from "../types";

export type AppStatus = "idle" | "loading" | "solving" | "ready" | "empty" | "error";

interface RowQuantitySetting {
  count: number;
  mode: QuantityMode;
}

export const useLoadoutStore = defineStore("loadout", () => {
  const aircraft = ref(readRecentAircraft()[0] || "");
  const loadedAircraft = ref<string | null>(null);
  const targetDamage = ref(23310);
  const rewardProfile = ref<BombingRewardProfile | null>(null);
  const top = ref(10);
  const maxOverkill = ref(5000);
  const sortBy = ref<SortBy>("high_yield");

  const options = ref<PreparedOption[]>([]);
  const pylons = ref<PreparedPylon[]>([]);
  const selectedOptions = ref<Set<string>>(new Set());
  const damageOverrides = ref<Record<string, number>>({});
  const quantitySettings = ref<Record<string, RowQuantitySetting>>({});
  const fixedPylons = ref<FixedPylons>({});


  const status = ref<AppStatus>("idle");
  const errorMessage = ref("");
  const lastResult = ref<SolveResult | null>(null);

  let loadRequestId = 0;
  let solveRequestId = 0;
  let loadAbortController: AbortController | null = null;

  const normalizedAircraft = computed(() => aircraft.value.trim());
  const isCurrentAircraftLoaded = computed(() => (
    Boolean(loadedAircraft.value)
      && loadedAircraft.value === normalizedAircraft.value
  ));
  const allRows = computed(() => buildOptionRows(options.value));
  const rowById = computed(() => new Map(allRows.value.map((row) => [row.id, row])));
  const groupedRows = computed<OptionGroup[]>(() => groupRows(allRows.value));
  const quantityConstraintEntries = computed<QuantityConstraint[]>(() => (
    Object.entries(quantitySettings.value).flatMap(([rowId, setting]) => {
      if (setting.count <= 0) return [];
      const constraint = makeRowQuantityConstraint(rowId, setting.count, setting.mode);
      return constraint ? [constraint] : [];
    })
  ));
  const quantityConstraintSignature = computed(() => (
    quantityConstraintEntries.value
      .map((constraint) => `${constraint.constraint_id || ""}:${constraint.mode}:${constraint.count}`)
      .sort()
      .join("|")
  ));
  const isBusy = computed(() => status.value === "loading" || status.value === "solving");
  const canSolve = computed(() => (
    options.value.length > 0
      && isCurrentAircraftLoaded.value
      && !isBusy.value
  ));
  const statusLabel = computed(() => {
    if (status.value === "loading") return "加载中";
    if (status.value === "solving") return "求解中";
    if (status.value === "error") return "出错";
    if (options.value.length > 0 && !isCurrentAircraftLoaded.value) return "需重新加载";
    if (status.value === "empty") return "无解";
    if (options.value.length > 0) return "已就绪";
    return "未加载";
  });
  const statusTone = computed(() => {
    if (status.value === "error") return "error";
    if (isBusy.value) return "busy";
    if (options.value.length > 0 && !isCurrentAircraftLoaded.value) return "warning";
    if (status.value === "empty") return "warning";
    if (options.value.length > 0) return "success";
    return "neutral";
  });
  const allRowsSelected = computed(() => allRows.value.length > 0 && allRows.value.every((row) => isRowSelected(row)));
  const selectedRowCount = computed(() => allRows.value.filter((row) => isRowSelected(row)).length);
  const allRowsPartiallySelected = computed(() => selectedOptions.value.size > 0 && !allRowsSelected.value);
  const optionById = computed(() => new Map(options.value.map((option) => [option.option_id, option])));
  const initialSummary = computed(() => {
    let damage = 0;
    let countedBaseDamage = 0;
    let weightKg = 0;
    let damageKnown = true;
    let weightKnown = true;
    let slotCount = 0;
    for (const optionId of Object.values(fixedPylons.value)) {
      if (optionId == null) continue;
      const option = optionById.value.get(optionId);
      if (!option) continue;
      const actual = Object.prototype.hasOwnProperty.call(damageOverrides.value, optionId)
        ? damageOverrides.value[optionId] : option.damage;
      if (actual == null || !Number.isFinite(actual)) damageKnown = false;
      else damage += actual;
      countedBaseDamage += option.counted_base_damage;
      weightKg += option.weight_kg;
      if (!option.weight_known) weightKnown = false;
      slotCount += 1;
    }
    return {
      damage: damageKnown ? damage : null,
      counted_base_damage: countedBaseDamage,
      total_weight_kg: weightKnown ? Math.round(weightKg * 10) / 10 : null,
      reward: calculateReward(countedBaseDamage, rewardProfile.value),
      slot_count: slotCount,
    };
  });
  function validateFixedPylons(fixed: Readonly<FixedPylons>): string | null {
    const bySlot = new Map(pylons.value.map((pylon) => [pylon.slot, pylon]));
    const locked = Object.entries(fixed);
    for (const [key, optionId] of locked) {
      const slot = Number(key);
      if (!bySlot.has(slot)) return `P${slot} 不存在。`;
      if (optionId == null) continue;
      const option = bySlot.get(slot)?.options.find((item) => item.option_id === optionId);
      if (!option) return `P${slot} 的固定预设已失效。`;
      for (const requiredId of option.required_option_ids || []) {
        const target = pylons.value.find((pylon) => pylon.options.some((item) => item.option_id === requiredId));
        if (!target || target.slot === slot) {
          return `P${slot} 的 ${option.displayName} 缺少可用的前置挂点。`;
        }
        if (Object.prototype.hasOwnProperty.call(fixed, target.slot) && fixed[target.slot] !== requiredId) {
          return `P${slot} 的 ${option.displayName} 需要 P${target.slot} 的指定配套挂载。`;
        }
      }
      for (const [otherKey, otherId] of locked) {
        if (otherId == null || otherKey === key) continue;
        const other = bySlot.get(Number(otherKey))?.options.find((item) => item.option_id === otherId);
        if (option.banned_option_ids?.includes(otherId) || other?.banned_option_ids?.includes(optionId)) {
          return `P${slot} 与 P${otherKey} 的固定挂载互斥。`;
        }
      }
    }
    return null;
  }

  const fixedConflict = computed(() => validateFixedPylons(fixedPylons.value));

  function fixedPylonChoiceConflict(slot: number, optionId: string | null): string | null {
    return validateFixedPylons({...fixedPylons.value, [slot]: optionId});
  }

  async function loadOptions(): Promise<void> {
    const requestedAircraft = normalizedAircraft.value;
    if (!requestedAircraft) {
      setError("请先填写飞机ID，例如 su_34 或 f_15e。");
      return;
    }

    const requestId = ++loadRequestId;
    loadAbortController?.abort();
    const controller = new AbortController();
    loadAbortController = controller;

    const previousDamageOverrides = damageOverrides.value;
    const previousQuantitySettings = quantitySettings.value;
    loadedAircraft.value = null;
    options.value = [];
    pylons.value = [];
    selectedOptions.value = new Set();
    fixedPylons.value = {};
    status.value = "loading";
    errorMessage.value = "";
    lastResult.value = null;
    rewardProfile.value = null;

    try {
      const data = await fetchOptions({aircraft: requestedAircraft}, controller.signal);
      if (requestId !== loadRequestId || controller.signal.aborted) return;

      options.value = data.options.map(prepareOption);
      pylons.value = preparePylons(data.pylons || [], options.value);
      rewardProfile.value = data.reward_profile || null;
      loadedAircraft.value = requestedAircraft;

      const optionIds = new Set(options.value.map((option) => option.option_id));
      const logicalRowIds = new Set(buildOptionRows(options.value).map((row) => row.id));
      damageOverrides.value = Object.fromEntries(
        Object.entries(previousDamageOverrides).filter(([optionId]) => optionIds.has(optionId)),
      );
      quantitySettings.value = Object.fromEntries(
        Object.entries(previousQuantitySettings).filter(([rowId]) => logicalRowIds.has(rowId)),
      );
      status.value = "ready";
    } catch (error) {
      if (requestId !== loadRequestId || controller.signal.aborted) return;
      clearLoadedAircraft();
      setError(error instanceof Error ? error.message : "读取挂载失败。");
    } finally {
      if (loadAbortController === controller) loadAbortController = null;
    }
  }

  async function solve(): Promise<void> {
    if (!canSolve.value) {
      if (options.value.length && !isCurrentAircraftLoaded.value) {
        setError("飞机ID已变更，请先重新加载当前飞机。");
      }
      return;
    }

    if (fixedConflict.value) {
      setError(fixedConflict.value);
      return;
    }
    const currentAircraft = normalizedAircraft.value;
    const requestId = ++solveRequestId;
    status.value = "solving";
    errorMessage.value = "";
    try {
      const startedAt = performance.now();
      const input: SolverInput = {
        pylons: clonePylons(pylons.value),
        targetDamage: safeInteger(targetDamage.value, 23310, 1),
        rewardProfile: cloneRewardProfile(rewardProfile.value),
        top: safeInteger(top.value, 10, 1),
        maxOverkill: safeInteger(maxOverkill.value, 5000, 0),
        sortBy: sortBy.value,
        allowedOptions: new Set(selectedOptions.value),
        damageOverrides: {...damageOverrides.value},
        quantityConstraints: quantityConstraintEntries.value,
        fixedPylons: {...fixedPylons.value},
      };
      const solutions = await solveInWorker(input);

      if (requestId !== solveRequestId
        || loadedAircraft.value !== currentAircraft
        || normalizedAircraft.value !== currentAircraft) {
        return;
      }

      lastResult.value = {
        aircraft: currentAircraft,
        target_damage: input.targetDamage,
        reward_profile: input.rewardProfile,
        damage_overrides: {...input.damageOverrides},
        quantity_constraints: input.quantityConstraints.map((constraint) => ({...constraint})),
        solutions,
        elapsed_ms: Math.round(performance.now() - startedAt),
      };
      status.value = solutions.length ? "ready" : "empty";
    } catch (error) {
      if (requestId !== solveRequestId) return;
      setError(error instanceof Error ? error.message : "求解失败。");
    }
  }

  function toggleAllRows(): void {
    if (allRowsSelected.value) {
      selectedOptions.value = new Set();
      return;
    }
    selectedOptions.value = new Set(allRows.value.flatMap((row) => row.optionIds));
  }

  function isRowSelected(row: OptionRow): boolean {
    return row.optionIds.length > 0 && row.optionIds.every((optionId) => selectedOptions.value.has(optionId));
  }

  function rowOption(rowId: string): PreparedOption | null {
    return rowById.value.get(rowId)?.option || null;
  }

  function rowOptions(rowId: string): PreparedOption[] {
    return rowById.value.get(rowId)?.options || [];
  }

  function optionUnitDamage(option: PreparedOption): number | null {
    if (Object.prototype.hasOwnProperty.call(damageOverrides.value, option.option_id)) {
      return damageOverrides.value[option.option_id] / Math.max(option.count, 1);
    }
    return option.damage == null ? null : option.damage / Math.max(option.count, 1);
  }

  function rowDamageValue(rowId: string): number | null {
    const option = rowOption(rowId);
    if (!option) return null;
    const damage = optionUnitDamage(option);
    return damage == null ? null : Math.round(damage);
  }

  function setRowDamage(rowId: string, value: number | null): void {
    const variants = rowOptions(rowId);
    if (!variants.length) return;
    const next = {...damageOverrides.value};
    if (value == null) {
      for (const option of variants) delete next[option.option_id];
    } else {
      if (!Number.isFinite(value) || value < 0) return;
      const unitDamage = Math.trunc(value);
      for (const option of variants) {
        next[option.option_id] = unitDamage * Math.max(option.count, 1);
      }
    }
    damageOverrides.value = next;
  }

  function rowQuantityMode(rowId: string): QuantityMode {
    return quantitySettings.value[rowId]?.mode || "at_least";
  }

  function rowQuantityValue(rowId: string): number | null {
    return quantitySettings.value[rowId]?.count ?? 0;
  }

  function makeRowQuantityConstraint(rowId: string, count: number, mode: QuantityMode): QuantityConstraint | null {
    const row = rowById.value.get(rowId);
    if (!row) return null;
    return {
      constraint_id: row.id,
      option_ids: [...row.optionIds],
      count_by: "weapon",
      count,
      mode,
    };
  }

  function toggleRowQuantityMode(rowId: string): void {
    if (!rowById.value.has(rowId)) return;
    const current = quantitySettings.value[rowId];
    const next = {...quantitySettings.value};
    next[rowId] = {
      count: current?.count ?? 0,
      mode: (current?.mode || "at_least") === "at_least" ? "exact" : "at_least",
    };
    quantitySettings.value = next;
  }

  function setRowQuantity(rowId: string, value: number | null): void {
    if (!rowById.value.has(rowId)) return;
    if (value != null && (!Number.isInteger(value) || value < 0 || value > 64)) return;

    const next = {...quantitySettings.value};
    const current = next[rowId];
    const count = value ?? 0;
    if (count === 0 && !current) return;
    next[rowId] = {count, mode: current?.mode || "at_least"};
    quantitySettings.value = next;
  }

  function setFixedPylon(slot: number, value: string | null | undefined): void {
    const pylon = pylons.value.find((item) => item.slot === slot);
    if (!pylon || (value != null && !pylon.options.some((option) => option.option_id === value))) return;
    const next = {...fixedPylons.value};
    if (value === undefined) delete next[slot];
    else next[slot] = value;
    fixedPylons.value = next;
  }

  function useSolutionAsInitial(solution: Solution): void {
    const next: FixedPylons = {};
    for (const selection of solution.selections || []) {
      if (pylons.value.some((pylon) => pylon.slot === selection.slot
        && pylon.options.some((option) => option.option_id === selection.option_id))) {
        next[selection.slot] = selection.option_id;
      }
    }
    fixedPylons.value = next;
  }

  function invalidateResult(): void {
    const wasSolving = status.value === "solving";
    solveRequestId += 1;
    if (wasSolving) cancelSolverWorker();
    errorMessage.value = "";
    lastResult.value = null;
    if (status.value !== "loading") {
      status.value = options.value.length ? "ready" : "idle";
    }
  }

  function clearLoadedAircraft(): void {
    loadedAircraft.value = null;
    options.value = [];
    pylons.value = [];
    selectedOptions.value = new Set();
    damageOverrides.value = {};
    quantitySettings.value = {};
    fixedPylons.value = {};
    rewardProfile.value = null;
    lastResult.value = null;
  }

  function setError(message: string): void {
    errorMessage.value = message;
    status.value = "error";
  }

  watch(
    [
      aircraft,
      targetDamage,
      top,
      maxOverkill,
      sortBy,
      selectedOptions,
      damageOverrides,
      quantityConstraintSignature,
      fixedPylons,
    ],
    invalidateResult,
  );

  return {
    aircraft,
    loadedAircraft,
    targetDamage,
    rewardProfile,
    top,
    maxOverkill,
    sortBy,
    options,
    pylons,
    selectedOptions,
    damageOverrides,
    quantitySettings,
    fixedPylons,
    initialSummary,
    fixedConflict,
    fixedPylonChoiceConflict,
    status,
    errorMessage,
    lastResult,
    allRows,
    groupedRows,
    isBusy,
    canSolve,
    statusLabel,
    statusTone,
    allRowsSelected,
    allRowsPartiallySelected,
    selectedRowCount,
    loadOptions,
    solve,
    toggleAllRows,
    isRowSelected,
    rowDamageValue,
    setRowDamage,
    rowQuantityMode,
    rowQuantityValue,
    toggleRowQuantityMode,
    setRowQuantity,
    setFixedPylon,
    useSolutionAsInitial,
  };
});

function clonePylons(pylons: PreparedPylon[]): PreparedPylon[] {
  return pylons.map((pylon) => ({
    slot: pylon.slot,
    options: pylon.options.map((option) => ({
      ...option,
      required_option_ids: option.required_option_ids ? [...option.required_option_ids] : undefined,
      banned_option_ids: option.banned_option_ids ? [...option.banned_option_ids] : undefined,
    })),
  }));
}

function cloneRewardProfile(profile: BombingRewardProfile | null): BombingRewardProfile | null {
  if (!profile) return null;
  return {
    is_fighter: profile.is_fighter,
    is_premium: profile.is_premium,
    fighter_bombing_reward_mul: profile.fighter_bombing_reward_mul,
    prem_bombing_reward_mul: profile.prem_bombing_reward_mul,
    low_reward_constant: profile.low_reward_constant,
    low_reward_inverse_damage: profile.low_reward_inverse_damage,
    piecewise_linear_table: profile.piecewise_linear_table.map(([damage, reward]) => [damage, reward] as [number, number]),
  };
}

interface ActiveSolverWorker {
  worker: Worker;
  api: Remote<SolverWorkerApi>;
  reject: ((error: Error) => void) | null;
}

let activeSolverWorker: ActiveSolverWorker | null = null;

function getSolverWorker(): ActiveSolverWorker {
  if (activeSolverWorker) return activeSolverWorker;

  const worker = new Worker(new URL("../domain/solver.worker.ts", import.meta.url), {type: "module"});
  const active: ActiveSolverWorker = {worker, api: wrap<SolverWorkerApi>(worker), reject: null};
  worker.onerror = (event) => {
    if (activeSolverWorker === active) {
      cancelSolverWorker(new Error(event.message || "求解线程加载/执行失败。"));
    }
  };
  worker.onmessageerror = () => {
    if (activeSolverWorker === active) {
      cancelSolverWorker(new Error("求解线程返回的数据无法读取。"));
    }
  };
  activeSolverWorker = active;
  return active;
}

function solveInWorker(input: SolverInput): Promise<Solution[]> {
  const active = getSolverWorker();
  return new Promise((resolve, reject) => {
    active.reject = reject;
    active.api.solve(input).then(
      (solutions) => {
        if (activeSolverWorker === active) active.reject = null;
        resolve(solutions);
      },
      (error: unknown) => {
        if (activeSolverWorker === active) active.reject = null;
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function cancelSolverWorker(reason = new Error("求解已取消。")): void {
  const active = activeSolverWorker;
  if (!active) return;
  activeSolverWorker = null;
  active.api[releaseProxy]();
  active.worker.terminate();
  active.reject?.(reason);
}
