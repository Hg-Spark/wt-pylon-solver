import {computed, ref, watch} from "vue";
import {defineStore} from "pinia";
import {fetchOptions} from "../services/api";
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
  OptionSubgroup,
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
  const aircraft = ref("su_34");
  const loadedAircraft = ref<string | null>(null);
  const targetDamage = ref(23310);
  const rewardProfile = ref<BombingRewardProfile | null>(null);
  const top = ref(10);
  const maxOverkill = ref(5000);
  const sortBy = ref<SortBy>("high_yield");

  const options = ref<PreparedOption[]>([]);
  const pylons = ref<PreparedPylon[]>([]);
  const availableSlots = ref<number[]>([]);
  const allowedSlots = ref<Set<number>>(new Set());
  const selectedOptions = ref<Set<string>>(new Set());
  const damageOverrides = ref<Record<string, number>>({});
  const quantitySettings = ref<Record<string, RowQuantitySetting>>({});
  const fixedPylons = ref<FixedPylons>({});

  const collapsedGroups = ref<Set<string>>(new Set());

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
  const slotSummary = computed(() => {
    const selected = availableSlots.value.filter((slot) => allowedSlots.value.has(slot));
    return selected.length ? `已选 ${selected.length}/${availableSlots.value.length} 个挂点` : "不限挂点";
  });
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
  const fixedConflict = computed(() => {
    const fixed = fixedPylons.value;
    const all = new Map(pylons.value.map((pylon) => [pylon.slot, pylon]));
    const locked = Object.entries(fixed);
    for (const [key, optionId] of locked) {
      const slot = Number(key);
      if (allowedSlots.value.size && !allowedSlots.value.has(slot)) {
        return `P${slot} 已固定，但当前挂点限制不允许使用该位置。`;
      }
      if (optionId == null) continue;
      const option = all.get(slot)?.options.find((item) => item.option_id === optionId);
      if (!option) return `P${slot} 的固定预设已失效。`;
      for (const requiredId of option.required_option_ids || []) {
        const match = pylons.value.find((pylon) => pylon.options.some((o) => o.option_id === requiredId));
        if (!match) return `P${slot} 的 ${option.displayName} 缺少必要挂载。`;
        if (Object.prototype.hasOwnProperty.call(fixed, match.slot) && fixed[match.slot] !== requiredId) {
          return `P${slot} 的 ${option.displayName} 需要 P${match.slot} 的指定配套挂载。`;
        }
      }
      for (const [otherKey, otherId] of locked) {
        if (otherId == null || otherKey === key) continue;
        const other = optionById.value.get(otherId);
        if (option.banned_option_ids?.includes(otherId) || other?.banned_option_ids?.includes(optionId)) {
          return `P${slot} 与 P${otherKey} 的固定挂载互斥。`;
        }
      }
    }
    return null;
  });
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
    availableSlots.value = [];
    allowedSlots.value = new Set();
    selectedOptions.value = new Set();
    fixedPylons.value = {};
    collapsedGroups.value = new Set();
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
      collapsedGroups.value = new Set(
        groupedRows.value.flatMap((group) => group.subgroups.map((subgroup) => subgroup.key)),
      );

      const optionIds = new Set(options.value.map((option) => option.option_id));
      const logicalRowIds = new Set(buildOptionRows(options.value).map((row) => row.id));
      damageOverrides.value = Object.fromEntries(
        Object.entries(previousDamageOverrides).filter(([optionId]) => optionIds.has(optionId)),
      );
      quantitySettings.value = Object.fromEntries(
        Object.entries(previousQuantitySettings).filter(([rowId]) => logicalRowIds.has(rowId)),
      );
      selectedOptions.value = new Set(options.value
        .filter((option) => !option.support && option.damage != null && option.damage > 0)
        .map((option) => option.option_id));
      availableSlots.value = [...new Set(pylons.value.map((pylon) => pylon.slot))].sort((left, right) => left - right);
      allowedSlots.value = new Set();
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
        allowedSlots: new Set(allowedSlots.value),
        allowedOptions: new Set(selectedOptions.value),
        damageOverrides: {...damageOverrides.value},
        quantityConstraints: quantityConstraintEntries.value.map(cloneQuantityConstraint),
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

  function toggleRowSelection(rowId: string, checked: boolean): void {
    const row = rowById.value.get(rowId);
    if (!row) return;
    const next = new Set(selectedOptions.value);
    for (const optionId of row.optionIds) {
      if (checked) next.add(optionId);
      else next.delete(optionId);
    }
    selectedOptions.value = next;
  }

  function isGroupSelected(group: OptionGroup): boolean {
    return isRowsSelected(group.rows);
  }

  function isGroupPartiallySelected(group: OptionGroup): boolean {
    return isRowsPartiallySelected(group.rows);
  }

  function isSubgroupSelected(subgroup: OptionSubgroup): boolean {
    return isRowsSelected(subgroup.rows);
  }

  function isSubgroupPartiallySelected(subgroup: OptionSubgroup): boolean {
    return isRowsPartiallySelected(subgroup.rows);
  }

  function isRowsSelected(rows: OptionRow[]): boolean {
    return rows.length > 0 && rows.every((row) => isRowSelected(row));
  }

  function isRowsPartiallySelected(rows: OptionRow[]): boolean {
    if (!rows.length) return false;
    const anySelected = rows.some((row) => row.optionIds.some((optionId) => selectedOptions.value.has(optionId)));
    return anySelected && !isRowsSelected(rows);
  }

  function toggleGroupSelection(group: OptionGroup): void {
    toggleRowsSelection(group.rows, isGroupSelected(group));
  }

  function toggleSubgroupSelection(subgroup: OptionSubgroup): void {
    toggleRowsSelection(subgroup.rows, isSubgroupSelected(subgroup));
  }

  function toggleRowsSelection(rows: OptionRow[], isSelected: boolean): void {
    const shouldSelect = !isSelected;
    const next = new Set(selectedOptions.value);
    for (const row of rows) {
      for (const optionId of row.optionIds) {
        if (shouldSelect) next.add(optionId);
        else next.delete(optionId);
      }
    }
    selectedOptions.value = next;
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

  function toggleGroup(key: string): void {
    const next = new Set(collapsedGroups.value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    collapsedGroups.value = next;
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

  function clearSlotLimit(): void {
    allowedSlots.value = new Set();
  }

  function toggleSlot(slot: number, checked: boolean): void {
    const next = new Set(allowedSlots.value);
    if (checked) next.add(slot);
    else next.delete(slot);
    allowedSlots.value = next;
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
    availableSlots.value = [];
    allowedSlots.value = new Set();
    selectedOptions.value = new Set();
    damageOverrides.value = {};
    quantitySettings.value = {};
    fixedPylons.value = {};
    collapsedGroups.value = new Set();
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
      allowedSlots,
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
    availableSlots,
    allowedSlots,
    selectedOptions,
    damageOverrides,
    quantitySettings,
    fixedPylons,
    initialSummary,
    fixedConflict,
    collapsedGroups,
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
    slotSummary,
    loadOptions,
    solve,
    toggleRowSelection,
    isGroupSelected,
    isGroupPartiallySelected,
    isSubgroupSelected,
    isSubgroupPartiallySelected,
    toggleGroupSelection,
    toggleSubgroupSelection,
    toggleAllRows,
    isRowSelected,
    rowDamageValue,
    setRowDamage,
    rowQuantityMode,
    rowQuantityValue,
    toggleRowQuantityMode,
    setRowQuantity,
    toggleGroup,
    clearSlotLimit,
    toggleSlot,
    setFixedPylon,
    useSolutionAsInitial,
  };
});

function clonePylons(pylons: PreparedPylon[]): PreparedPylon[] {
  return pylons.map((pylon) => ({
    slot: pylon.slot,
    options: pylon.options.map((option) => ({...option})),
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

function cloneQuantityConstraint(constraint: QuantityConstraint): QuantityConstraint {
  return {
    ...(constraint.option_id ? {option_id: constraint.option_id} : {}),
    ...(constraint.option_ids ? {option_ids: [...constraint.option_ids]} : {}),
    ...(constraint.constraint_id ? {constraint_id: constraint.constraint_id} : {}),
    ...(constraint.count_by ? {count_by: constraint.count_by} : {}),
    count: constraint.count,
    mode: constraint.mode,
  };
}

interface SolverWorkerResponse {
  id: number;
  solutions?: Solution[];
  error?: string;
}

interface PendingSolverRequest {
  resolve: (solutions: Solution[]) => void;
  reject: (error: Error) => void;
}

let solverWorker: Worker | null = null;
let solverWorkerRequestId = 0;
const pendingSolverRequests = new Map<number, PendingSolverRequest>();

function getSolverWorker(): Worker {
  if (solverWorker) return solverWorker;

  const worker = new Worker(new URL("../domain/solver.worker.ts", import.meta.url), {type: "module"});
  worker.onmessage = (event: MessageEvent<SolverWorkerResponse>) => {
    const pending = pendingSolverRequests.get(event.data.id);
    if (!pending) return;
    pendingSolverRequests.delete(event.data.id);
    if (event.data.error) {
      pending.reject(new Error(event.data.error));
      return;
    }
    pending.resolve(event.data.solutions || []);
  };
  worker.onerror = (event: ErrorEvent) => {
    const detail = event.message || event.filename;
    failSolverWorker(new Error(
      detail
        ? `求解线程加载/执行失败：${detail}`
        : "求解线程加载/执行失败，请检查前端 Worker 资源是否已部署。",
    ), worker);
  };
  worker.onmessageerror = () => {
    failSolverWorker(new Error("求解线程返回的数据无法读取。"), worker);
  };
  solverWorker = worker;
  return worker;
}

function solveInWorker(input: SolverInput): Promise<Solution[]> {
  const worker = getSolverWorker();
  const id = ++solverWorkerRequestId;
  return new Promise((resolve, reject) => {
    pendingSolverRequests.set(id, {resolve, reject});
    try {
      worker.postMessage({id, input});
    } catch (error) {
      pendingSolverRequests.delete(id);
      reject(error instanceof Error ? error : new Error("无法向求解线程发送数据。"));
    }
  });
}

function cancelSolverWorker(): void {
  if (!solverWorker && pendingSolverRequests.size === 0) return;
  failSolverWorker(new Error("求解已取消。"));
}

function failSolverWorker(error: Error, sourceWorker?: Worker): void {
  if (sourceWorker && solverWorker !== sourceWorker) return;
  if (solverWorker) {
    solverWorker.terminate();
    solverWorker = null;
  }
  for (const pending of pendingSolverRequests.values()) pending.reject(error);
  pendingSolverRequests.clear();
}
