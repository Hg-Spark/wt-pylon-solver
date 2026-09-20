<script setup lang="ts">
import {computed, ref, watch} from "vue";
import Button from "primevue/button";
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import InputNumber from "primevue/inputnumber";
import Select from "primevue/select";
import {groupSolutionSelections, solutionId} from "../domain/loadout";
import {formatNumber} from "../utils/format";
import {useLoadoutStore} from "../stores/loadout";
import type {Solution, SortBy} from "../types";

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
const expandedRows = ref<Record<string, boolean>>({});

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

watch(() => store.lastResult, () => {
  expandedRows.value = {};
});

function setTargetDamage(value: number | null): void {
  if (value != null) store.targetDamage = value;
}

function setTop(value: number | null): void {
  if (value != null) store.top = value;
}

function rowClass(row: ResultRow): string {
  return row.rank === 1 ? "recommended-row" : "";
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

    <div v-if="store.lastResult && resultCount" class="table-panel">
      <DataTable
        v-model:expanded-rows="expandedRows"
        :value="resultRows"
        data-key="id"
        sort-field="rank"
        :sort-order="1"
        :row-class="rowClass"
        class="results-datatable"
        table-style="min-width: 680px"
      >
        <Column expander style="width: 3rem" />

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

        <template #expansion="{data}">
          <div v-if="data.solution.selections?.length">
            <div class="selection-grid">
            <div
              v-for="selection in groupSolutionSelections(data.solution.selections)"
              :key="selection.key"
              class="selection-card"
            >
              <strong>{{ selection.name }}</strong>
              <span>×{{ selection.totalCount }} · {{ formatNumber(selection.damage) }}</span>
            </div>
            </div>
          </div>
          <div v-else class="empty-inline">没有挂载数据。</div>
        </template>
      </DataTable>
    </div>

    <div v-else-if="store.lastResult" class="empty-state results-empty">
      <strong>没有找到可行方案</strong>
      <p>调整目标伤害或挂点限制后重新求解。</p>
    </div>

    <div v-else class="empty-state results-empty">
      <strong>等待求解结果</strong>
    </div>
  </section>
</template>
