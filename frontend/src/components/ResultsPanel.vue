<script setup lang="ts">
import {computed, ref, watch} from "vue";
import Button from "primevue/button";
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import Popover from "primevue/popover";
import Select from "primevue/select";
import {solutionId} from "../domain/loadout";
import {formatNumber} from "../utils/format";
import {useLoadoutStore} from "../stores/loadout";
import type {PreparedOption, Selection, Solution, SortBy} from "../types";

interface MountStation {
  slot: number;
  selection: Selection | null;
  option: PreparedOption | null;
  state: "free" | "empty" | "fixed" | "result";
}

interface ResultRow {
  id: string;
  rank: number;
  damage: number | null;
  counted_base_damage: number | null;
  reward: number | null;
  total_weight_kg: number | null;
  slot_count: number | null;
  solution: Solution;
}

const store = useLoadoutStore();
const selectedRowId = ref<string | null>(null);
const previewMode = ref<"initial" | "result">("initial");
const mountSearch = ref("");
const missingIcons = ref<Set<string>>(new Set());
const stationMenus = new Map<number, {toggle: (event: Event) => void; hide: () => void}>();


const sortOptions: Array<{label: string; value: SortBy}> = [
  {label: "高收益", value: "high_yield"},
  {label: "少挂点", value: "weapons"},
  {label: "低总重", value: "weight"},
];

const resultRows = computed<ResultRow[]>(() => (
  (store.lastResult?.solutions || []).map((solution, index) => ({
    id: solutionId(solution),
    rank: index + 1,
    damage: solution.damage ?? null,
    counted_base_damage: solution.counted_base_damage ?? null,
    reward: solution.reward ?? null,
    total_weight_kg: solution.total_weight_kg ?? null,
    slot_count: solution.slot_count ?? solution.selections?.length ?? null,
    solution,
  }))
));

const resultCount = computed(() => resultRows.value.length);
const activeRow = computed(() => (
  resultRows.value.find((row) => row.id === selectedRowId.value) || resultRows.value[0] || null
));
const optionById = computed(() => new Map(store.options.map((option) => [option.option_id, option])));
const mountStations = computed<MountStation[]>(() => {
  const selections = previewMode.value === "result" ? activeRow.value?.solution.selections || [] : [];
  const selected = new Map(selections.map((item) => [item.slot, item] as const));
  return store.pylons.map((pylon) => {
    const selection = selected.get(pylon.slot) || null;
    const fixed = store.fixedPylons[pylon.slot];
    const locked = Object.prototype.hasOwnProperty.call(store.fixedPylons, pylon.slot);
    const state: MountStation["state"] = previewMode.value === "result"
      ? (selection ? "result" : "empty")
      : !locked ? "free" : fixed == null ? "empty" : "fixed";
    const optionId = previewMode.value === "result" ? selection?.option_id : fixed;
    return {
      slot: pylon.slot,
      selection,
      option: optionId ? optionById.value.get(optionId) || null : null,
      state,
    };
  }).sort((a, b) => a.slot - b.slot);
});
const metrics = computed(() => previewMode.value === "initial" || !activeRow.value
  ? store.initialSummary : {
    ...activeRow.value.solution,
    total_weight_kg: (activeRow.value.solution.selections || []).some((selection) =>
      !optionById.value.get(selection.option_id)?.weight_known)
      ? null : activeRow.value.solution.total_weight_kg,
  });

watch(() => store.lastResult, (result) => {
  selectedRowId.value = null;
  previewMode.value = result?.solutions.length ? "result" : "initial";
});

function selectResult(event: {data: ResultRow}): void {
  selectedRowId.value = event.data.id;
  previewMode.value = "result";
}

function registerMountMenu(slot: number, instance: unknown): void {
  if (instance && typeof instance === "object" && "toggle" in instance && "hide" in instance) {
    stationMenus.set(slot, instance as {toggle: (event: Event) => void; hide: () => void});
  } else {
    stationMenus.delete(slot);
  }
}

function openMountMenu(slot: number, event: Event): void {
  mountSearch.value = "";
  for (const [other, menu] of stationMenus) {
    if (other !== slot) menu.hide();
  }
  stationMenus.get(slot)?.toggle(event);
}

function selectMount(slot: number, optionId: string | null | undefined): void {
  store.setFixedPylon(slot, optionId);
  stationMenus.get(slot)?.hide();
}

function mountOptions(slot: number): PreparedOption[] {
  const match = store.pylons.find((pylon) => pylon.slot === slot);
  const query = mountSearch.value.trim().toLowerCase();
  return (match?.options || []).filter((option) => !query ||
    option.displayName.toLowerCase().includes(query) ||
    option.option_id.toLowerCase().includes(query))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "zh-CN"));
}

function iconSrc(option: PreparedOption | null): string | null {
  const name = option?.icon_type;
  if (!name || !/^[a-z0-9_-]+$/.test(name) || missingIcons.value.has(name)) return null;
  return `${import.meta.env.BASE_URL}icons/${name}.png`;
}

function markIconMissing(option: PreparedOption | null): void {
  if (!option?.icon_type) return;
  missingIcons.value = new Set([...missingIcons.value, option.icon_type]);
}

function mountName(station: MountStation): string {
  return station.option?.displayName || station.selection?.weapon_display_name || "未知挂载";
}

function setTargetDamage(value: number | null): void {
  if (value != null) store.targetDamage = value;
}

function setTop(value: number | null): void {
  if (value != null) store.top = value;
}

function rowClass(row: ResultRow): string {
  return [
    row.rank === 1 ? "recommended-row" : "",
    previewMode.value === "result" && row.id === activeRow.value?.id ? "selected-result-row" : "",
  ].filter(Boolean).join(" ");
}

function formatReward(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return value.toFixed(3);
}
</script>

<template>
  <section class="results-page" aria-labelledby="results-section-title">
    <div class="results-toolbar">
      <div class="results-title-block">
        <div class="eyebrow">SOLUTION RESULTS</div>
        <div class="results-title-line">
          <h2 id="results-section-title">方案结果</h2>
          <span v-if="store.lastResult" class="results-meta">
            {{ resultCount }} 个 · {{ store.lastResult.elapsed_ms }} ms
          </span>
        </div>
      </div>

      <div class="result-controls" aria-label="求解控制">
        <label class="result-control" for="targetDamage">
          <span>目标伤害</span>
          <InputNumber
            input-id="targetDamage"
            :model-value="store.targetDamage"
            :min="1"
            :use-grouping="false"
            :max-fraction-digits="0"
            @update:model-value="setTargetDamage"
          />
        </label>

        <label class="result-control result-control-top" for="top">
          <span>方案数</span>
          <InputNumber
            input-id="top"
            :model-value="store.top"
            :min="1"
            :max="50"
            :use-grouping="false"
            :max-fraction-digits="0"
            @update:model-value="setTop"
          />
        </label>

        <label class="result-control result-control-sort" for="sortBy">
          <span>排序</span>
          <Select
            input-id="sortBy"
            append-to="self"
            v-model="store.sortBy"
            :options="sortOptions"
            option-label="label"
            option-value="value"
          />
        </label>

        <Button
          class="button-solve"
          label="求解方案"
          :loading="store.isBusy && store.status === 'solving'"
          :disabled="!store.canSolve"
          @click="store.solve"
        />
      </div>
    </div>

    <section v-if="store.pylons.length" class="mount-preview" aria-label="挂载布局编辑与预览">
      <div class="mount-preview-heading">
        <div>
          <strong>{{ previewMode === "initial" ? "初始挂载 · 点击挂点直接编辑" : `方案 #${activeRow?.rank || 1} · 完整挂载` }}</strong>
          <p>{{ previewMode === "initial" ? "固定武器不计入左侧新增数量约束；自由挂点由求解器补齐。" : "点击下方结果行切换方案；不会修改初始配置。" }}</p>
        </div>
        <div class="mount-preview-actions">
          <Button label="初始配置" :outlined="previewMode !== 'initial'" size="small" severity="secondary" @click="previewMode = 'initial'" />
          <Button label="方案预览" :outlined="previewMode !== 'result'" size="small" severity="secondary" :disabled="!activeRow" @click="previewMode = 'result'" />
        </div>
      </div>
      <div v-if="store.fixedConflict && previewMode === 'initial'" class="mount-preview-warning" role="alert">
        {{ store.fixedConflict }}
      </div>
      <div class="mount-preview-scroll" tabindex="0" role="region" aria-label="挂点列表，可横向滚动">
        <div class="mount-preview-grid" :style="{gridTemplateColumns: `repeat(${Math.max(1, mountStations.length)}, minmax(90px, 1fr))`}">
          <div v-for="station in mountStations" :key="station.slot" class="mount-preview-station-frame">
            <button
              type="button"
              class="mount-preview-station"
              :class="[`mount-preview-station-${station.state}`, { 'mount-preview-station-support': station.option?.support }]"
              :disabled="previewMode === 'result'"
              :aria-label="`P${station.slot}：${station.option ? mountName(station) : station.state === 'free' ? '自由' : '空'}，点击编辑`"
              @click="openMountMenu(station.slot, $event)"
            >
              <span class="mount-preview-number">P{{ station.slot }}</span>
              <span class="mount-preview-icon">
                <img v-if="iconSrc(station.option)" :src="iconSrc(station.option) || ''" alt="" @error="markIconMissing(station.option)" />
                <span v-else class="mount-preview-icon-fallback">{{ station.state === "free" ? "+" : station.option ? "◇" : "—" }}</span>
              </span>
              <strong class="mount-preview-weapon" :title="station.option?.option_id || undefined">
                {{ station.option ? mountName(station) : station.state === "free" ? "自由" : station.state === "result" ? "空" : station.state === "empty" && previewMode === "initial" ? "固定为空" : "空" }}
              </strong>
              <span v-if="station.option" class="mount-preview-count">×{{ station.selection?.count ?? station.option.count }}</span>
              <span v-else-if="previewMode === 'initial'" class="mount-preview-count">{{ station.state === 'free' ? '可自动补齐' : '禁止挂载' }}</span>
              <span v-if="station.option?.support" class="mount-preview-device">配套设备</span>
            </button>
            <Popover v-if="previewMode === 'initial'" :ref="(instance) => registerMountMenu(station.slot, instance)" append-to="body" class="mount-picker-popover">
              <div class="mount-picker">
                <strong>P{{ station.slot }} · 选择初始挂载</strong>
                <div class="mount-picker-special">
                  <button type="button" :class="{chosen: station.state === 'free'}" @click="selectMount(station.slot, undefined)">+ 自由（自动求解）</button>
                  <button type="button" :class="{chosen: station.state === 'empty'}" @click="selectMount(station.slot, null)">— 固定为空</button>
                </div>
                <InputText v-model="mountSearch" class="mount-picker-search" size="small" placeholder="搜索该挂点武器…" aria-label="搜索挂点武器" />
                <div class="mount-picker-options">
                  <button
                    v-for="option in mountOptions(station.slot)"
                    :key="option.option_id"
                    type="button"
                    class="mount-picker-option"
                    :class="{chosen: store.fixedPylons[station.slot] === option.option_id}"
                    @click="selectMount(station.slot, option.option_id)"
                  >
                    <img v-if="iconSrc(option)" :src="iconSrc(option) || ''" alt="" @error="markIconMissing(option)" />
                    <span v-else class="mount-picker-icon-fallback">◇</span>
                    <span>{{ option.displayName }}<small>×{{ option.count }}{{ option.support ? " · 配套设备" : "" }}</small></span>
                  </button>
                  <span v-if="!mountOptions(station.slot).length" class="mount-picker-no-matches">没有匹配的挂载预设</span>
                </div>
              </div>
            </Popover>
          </div>
        </div>
      </div>
      <div class="mount-preview-metrics" aria-label="当前挂载指标">
        <div><span>实际伤害</span><strong>{{ formatNumber(metrics.damage) }}</strong></div>
        <div><span>显示伤害</span><strong>{{ formatNumber(metrics.counted_base_damage) }}</strong></div>
        <div><span>重量</span><strong>{{ metrics.total_weight_kg == null ? '未知' : `${formatNumber(metrics.total_weight_kg, 1)} kg` }}</strong></div>
        <div><span>战区收益</span><strong>{{ formatReward(metrics.reward ?? null) }}</strong></div>
      </div>
      <div class="mount-preview-footer">
        <span>{{ previewMode === "initial" ? "只统计固定部分；实际伤害未知和重量缺失会明确标出。" : "已选方案完整统计；重量缺失时不显示不准确的合计。" }}</span>
        <Button v-if="previewMode === 'result' && activeRow" size="small" label="以此方案作为初始挂载" severity="secondary" text @click="store.useSolutionAsInitial(activeRow.solution)" />
      </div>
    </section>

    <div v-if="store.lastResult && resultCount" class="table-panel">
      <DataTable
        :value="resultRows"
        data-key="id"
        sort-field="rank"
        :sort-order="1"
        :row-class="rowClass"
        @row-click="selectResult"
        class="results-datatable"
        table-style="min-width: 680px"
      >
        <Column field="rank" header="排名" sortable header-class="numeric-column" body-class="numeric-column rank-column">
          <template #body="{data}">
            <span class="table-rank">{{ data.rank }}</span>
          </template>
        </Column>

        <Column field="damage" header="实际伤害" sortable header-class="numeric-column" body-class="numeric-column">
          <template #body="{data}">{{ formatNumber(data.damage) }}</template>
        </Column>
        <Column field="counted_base_damage" header="显示伤害" sortable header-class="numeric-column" body-class="numeric-column">
          <template #body="{data}">{{ formatNumber(data.counted_base_damage) }}</template>
        </Column>
        <Column field="reward" header="战区收益" sortable header-class="numeric-column" body-class="numeric-column">
          <template #body="{data}">{{ formatReward(data.reward) }}</template>
        </Column>
        <Column field="total_weight_kg" header="总重 (kg)" sortable header-class="numeric-column" body-class="numeric-column">
          <template #body="{data}">{{ formatNumber(data.total_weight_kg, 1) }}</template>
        </Column>
        <Column field="slot_count" header="挂点数" sortable header-class="numeric-column" body-class="numeric-column">
          <template #body="{data}">{{ formatNumber(data.slot_count) }}</template>
        </Column>


      </DataTable>
    </div>

    <div v-else-if="store.lastResult" class="empty-state results-empty">
      <strong>没有找到可行方案</strong>
      <p>调整目标伤害、候选武器或挂点矩阵中的固定配置后重新求解。</p>
    </div>

    <div v-else class="empty-state results-empty">
      <strong>等待求解结果</strong>
    </div>
  </section>
</template>
