<script setup lang="ts">
import {onMounted, ref, watch} from "vue";
import AutoComplete from "primevue/autocomplete";
import Button from "primevue/button";
import Checkbox from "primevue/checkbox";
import InputNumber from "primevue/inputnumber";
import {fetchAircraftIndex} from "../services/api";
import {AIRCRAFT_NATIONS, aircraftLabel, aircraftNationLabel, cleanAircraftName, normalizeAircraftSearch, readRecentAircraft, saveRecentAircraft, searchAircraft} from "../domain/aircraft";
import type {AircraftIndexItem} from "../types";
import {useLoadoutStore} from "../stores/loadout";

const store = useLoadoutStore();
const expandedRows = ref<Set<string>>(new Set());
const aircraftIndex = ref<AircraftIndexItem[]>([]);
const aircraftSuggestions = ref<AircraftIndexItem[]>([]);
const aircraftInput = ref<AircraftIndexItem | string | null>(store.aircraft);
const recentIds = ref<string[]>(readRecentAircraft());
const aircraftSearchError = ref("");
const selectedNation = ref("");

onMounted(async () => {
  try {
    aircraftIndex.value = await fetchAircraftIndex();
    if (aircraftInput.value === store.aircraft) {
      aircraftInput.value = aircraftIndex.value.find((item) => item.id === store.aircraft) || store.aircraft;
    }
  } catch (error) {
    aircraftSearchError.value = error instanceof Error ? error.message : "无法加载飞机目录。";
  }
});

function completeAircraft(event: {query: string}): void {
  aircraftSuggestions.value = searchAircraft(aircraftIndex.value, event.query, recentIds.value, 20, selectedNation.value);
}

watch(selectedNation, () => {
  const query = typeof aircraftInput.value === "string" ? aircraftInput.value : "";
  aircraftSuggestions.value = searchAircraft(aircraftIndex.value, query, recentIds.value, 20, selectedNation.value);
});

function recentAircraft(): AircraftIndexItem[] {
  const byId = new Map(aircraftIndex.value.map((item) => [item.id, item]));
  return recentIds.value.map((id) => byId.get(id)).filter((item): item is AircraftIndexItem => item !== undefined).slice(0, 5);
}

async function loadAircraft(id: string): Promise<void> {
  aircraftSearchError.value = "";
  if (store.loadedAircraft !== id) {
    store.aircraft = id;
    await store.loadOptions();
  }
  if (store.loadedAircraft === id) {
    recentIds.value = saveRecentAircraft(id, recentIds.value);
    aircraftInput.value = aircraftIndex.value.find((item) => item.id === id) || id;
  }
}

function selectAircraft(event: {value: AircraftIndexItem}): void {
  void loadAircraft(event.value.id);
}

function loadTypedAircraft(): void {
  if (aircraftInput.value && typeof aircraftInput.value === "object") {
    void loadAircraft(aircraftInput.value.id);
    return;
  }
  const input = String(aircraftInput.value || "").trim();
  const normalized = normalizeAircraftSearch(input);
  const exact = aircraftIndex.value.find((item) =>
    item.id.toLowerCase() === input.toLowerCase()
    || normalizeAircraftSearch(item.zh) === normalized
    || normalizeAircraftSearch(item.en) === normalized);
  if (exact) {
    void loadAircraft(exact.id);
  } else if (/^[a-z0-9_-]+$/i.test(input)) {
    void loadAircraft(input.toLowerCase());
  } else {
    aircraftSearchError.value = "请从搜索结果中选择飞机，或输入完整 Datamine ID。";
  }
}


function toggleDetails(rowId: string): void {
  const next = new Set(expandedRows.value);
  if (next.has(rowId)) next.delete(rowId);
  else next.add(rowId);
  expandedRows.value = next;
}

</script>

<template>
  <aside class="sidebar-panel library-panel" aria-labelledby="library-section-title">
    <div class="panel-heading library-heading">
      <div class="library-title">
        <div class="eyebrow">LOADOUT LIBRARY</div>
        <h2 id="library-section-title">挂载库</h2>
        <p v-if="store.options.length">已启用 {{ store.selectedRowCount }} / {{ store.allRows.length }} 种</p>
      </div>

      <div class="library-aircraft-picker">
        <div class="library-aircraft-field">
          <label for="aircraftId">选择飞机</label>
          <span class="aircraft-control">
            <select v-model="selectedNation" class="aircraft-nation-select" aria-label="飞机系别">
              <option value="">全部系别</option>
              <option v-for="nation in AIRCRAFT_NATIONS" :key="nation.value" :value="nation.value">{{ nation.label }}</option>
            </select>
            <AutoComplete
              input-id="aircraftId"
              v-model="aircraftInput"
              class="aircraft-autocomplete"
              :suggestions="aircraftSuggestions"
              :option-label="aircraftLabel"
              :min-length="0"
              :delay="0"
              complete-on-focus
              dropdown
              dropdown-mode="blank"
              append-to="self"
              scroll-height="280px"
              placeholder="名称或 Datamine ID"
              :disabled="store.status === 'solving'"
              @complete="completeAircraft"
              @item-select="selectAircraft"
            >
              <template #option="{option}">
                <div class="aircraft-option">
                  <span class="aircraft-option-name">{{ aircraftLabel(option) }}</span>
                  <small>{{ option.en && cleanAircraftName(option.en) !== aircraftLabel(option) ? cleanAircraftName(option.en) + " · " : "" }}{{ option.id }}</small>
                  <span class="aircraft-nation-mark">{{ aircraftNationLabel(option.nation) }}</span>
                  <span v-if="recentIds.includes(option.id)" class="aircraft-recent-mark">最近</span>
                </div>
              </template>
            </AutoComplete>
            <Button
              class="load-button"
              :label="store.status === 'loading' ? '加载中' : '加载'"
              severity="secondary"
              outlined
              :disabled="store.isBusy"
              @click="loadTypedAircraft"
            />
          </span>
        </div>
        <div v-if="recentAircraft().length" class="aircraft-recents">
          <span>最近</span>
          <button v-for="item in recentAircraft()" :key="item.id" type="button"
            :disabled="store.isBusy" :title="item.id" @click="loadAircraft(item.id)">
            {{ aircraftLabel(item) }}
          </button>
        </div>
        <p v-if="aircraftSearchError" class="aircraft-search-error">{{ aircraftSearchError }}</p>
      </div>
    </div>

    <div v-if="!store.options.length" class="library-empty">
      <strong>{{ store.status === "loading" ? "正在加载挂载数据" : "还没有挂载数据" }}</strong>
      <p>{{ store.status === "loading" ? "正在读取选中的飞机挂载数据。" : "通过名称、型号或 Datamine ID 搜索并选择飞机。" }}</p>
    </div>

    <div v-else-if="!store.groupedRows.length" class="library-empty">
      <strong>没有可用挂载</strong>
      <p>当前飞机没有可用的挂载数据。</p>
    </div>

    <div v-else class="option-groups">
      <div class="mount-list-header">
        <label class="checkbox-with-label">
          <Checkbox
            binary
            :model-value="store.allRowsSelected"
            :indeterminate="store.allRowsPartiallySelected"
            aria-label="选择全部挂载"
            @update:model-value="store.toggleAllRows"
          />
          <span>全部挂载</span>
        </label>
        <span>单枚伤害 · 高级条件</span>
      </div>

      <section v-for="group in store.groupedRows" :key="group.key" class="tree-group">
        <div class="tree-folder" :class="{selected: store.isGroupSelected(group)}">
          <Checkbox
            binary
            :model-value="store.isGroupSelected(group)"
            :indeterminate="store.isGroupPartiallySelected(group)"
            :aria-label="`${group.label}全选`"
            @update:model-value="store.toggleGroupSelection(group)"
          />
          <button class="tree-folder-toggle" type="button" :aria-expanded="!store.collapsedGroups.has(group.key)" @click="store.toggleGroup(group.key)">
            <span class="folder-caret" :class="{closed: store.collapsedGroups.has(group.key)}">⌄</span>
            <strong>{{ group.label }} ({{ group.rows.length }})</strong>
          </button>
        </div>

        <div v-if="!store.collapsedGroups.has(group.key)" class="tree-children">
          <section v-for="subgroup in group.subgroups" :key="subgroup.key" class="tree-subgroup">
            <div class="tree-subfolder" :class="{selected: store.isSubgroupSelected(subgroup)}">
              <Checkbox
                binary
                :model-value="store.isSubgroupSelected(subgroup)"
                :indeterminate="store.isSubgroupPartiallySelected(subgroup)"
                :aria-label="`${subgroup.label}全选`"
                @update:model-value="store.toggleSubgroupSelection(subgroup)"
              />
              <button class="tree-subfolder-toggle" type="button" :aria-expanded="!store.collapsedGroups.has(subgroup.key)" @click="store.toggleGroup(subgroup.key)">
                <span class="folder-caret" :class="{closed: store.collapsedGroups.has(subgroup.key)}">⌄</span>
                <span>{{ subgroup.label }} ({{ subgroup.rows.length }})</span>
              </button>
            </div>

            <div v-if="!store.collapsedGroups.has(subgroup.key)" class="mount-list">
              <article v-for="row in subgroup.rows" :key="row.id" class="mount-row" :class="{selected: store.isRowSelected(row)}">
                <label class="mount-name-cell checkbox-with-label mount-option-checkbox">
                  <Checkbox
                    binary
                    :model-value="store.isRowSelected(row)"
                    :aria-label="`允许使用 ${row.label}`"
                    @update:model-value="store.toggleRowSelection(row.id, Boolean($event))"
                  />
                  <span class="mount-label">
                    <span class="mount-label-text">{{ row.label }}</span>
                    <span
                      v-if="row.hasZeroDisplayDamage"
                      class="zero-display-damage-badge"
                      title="该挂载有实际伤害，但显示伤害为 0"
                    >显示伤害 0</span>
                  </span>
                </label>

                <div class="mount-row-tools">
                  <span class="mount-row-damage">伤害 {{ store.rowDamageValue(row.id) ?? "—" }}</span>
                  <span v-if="(store.rowQuantityValue(row.id) || 0) > 0" class="mount-row-condition">
                    新增 {{ store.rowQuantityMode(row.id) === "exact" ? "=" : "≥" }}{{ store.rowQuantityValue(row.id) }}
                  </span>
                  <Button
                    size="small"
                    text
                    severity="secondary"
                    class="mount-row-detail-button"
                    :label="expandedRows.has(row.id) ? '收起' : '调整'"
                    :aria-expanded="expandedRows.has(row.id)"
                    :aria-label="`${row.label}：${expandedRows.has(row.id) ? '收起' : '展开'}伤害和新增数量设置`"
                    @click="toggleDetails(row.id)"
                  />
                </div>
                <div v-if="expandedRows.has(row.id)" class="mount-advanced">
                  <label class="mount-editor damage-editor" title="修改单枚实际伤害，应用到同种武器各挂载预设">
                    <span class="mount-advanced-label">单枚实际伤害</span>
                    <InputNumber
                      class="mount-number"
                      :model-value="store.rowDamageValue(row.id)"
                      :min="0"
                      :max="1000000"
                      :use-grouping="false"
                      :max-fraction-digits="0"
                      placeholder="—"
                      @update:model-value="store.setRowDamage(row.id, $event)"
                    />
                  </label>
                  <div class="quantity-field">
                    <span class="mount-advanced-label">新增数量（固定挂载不计入）</span>
                    <div class="quantity-editor">
                      <Button
                        title="= 恰好新增 N 枚；≥ 至少新增 N 枚。固定挂载不计入"
                        class="quantity-mode-button"
                        :label="store.rowQuantityMode(row.id) === 'exact' ? '=' : '≥'"
                        severity="secondary"
                        outlined
                        :aria-label="`${row.label}数量条件，点击切换`"
                        @click="store.toggleRowQuantityMode(row.id)"
                      />
                      <InputNumber
                        class="quantity-input"
                        :model-value="store.rowQuantityValue(row.id)"
                        :min="0"
                        :max="64"
                        :use-grouping="false"
                        :max-fraction-digits="0"
                        :aria-label="`${row.label}新增数量`"
                        @update:model-value="store.setRowQuantity(row.id, $event)"
                      />
                    </div>
                  </div>
                </div>
              </article>
            </div>
          </section>
        </div>
      </section>
    </div>
  </aside>
</template>
