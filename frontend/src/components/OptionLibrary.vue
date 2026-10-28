<script setup lang="ts">
import {ref} from "vue";
import Button from "primevue/button";
import Checkbox from "primevue/checkbox";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import {useLoadoutStore} from "../stores/loadout";

const store = useLoadoutStore();
const expandedRows = ref<Set<string>>(new Set());

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

      <label class="library-aircraft-field" for="aircraftId">
        <span>飞机 ID</span>
        <span class="aircraft-control">
          <InputText
            id="aircraftId"
            v-model="store.aircraft"
            class="aircraft-input"
            placeholder="例如 su_34 / f_15e"
            autocomplete="off"
            @keydown.enter.prevent="store.loadOptions"
          />
          <Button
            class="load-button"
            :label="store.status === 'loading' ? '切换' : '加载'"
            severity="secondary"
            outlined
            :disabled="store.status === 'solving'"
            @click="store.loadOptions"
          />
        </span>
      </label>
    </div>

    <div v-if="!store.options.length" class="library-empty">
      <strong>{{ store.status === "loading" ? "正在加载挂载数据" : "还没有挂载数据" }}</strong>
      <p>{{ store.status === "loading" ? "可以修改飞机 ID 并再次点击“切换”。" : "在挂载库输入飞机 ID 并加载。" }}</p>
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
