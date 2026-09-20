<script setup lang="ts">
import Button from "primevue/button";
import Checkbox from "primevue/checkbox";
import InputNumber from "primevue/inputnumber";
import {useLoadoutStore} from "../stores/loadout";

const store = useLoadoutStore();

function setMaxOverkill(value: number | null): void {
  if (value != null) store.maxOverkill = value;
}
</script>

<template>
  <div class="solver-settings" aria-label="求解设置">
    <div class="settings-popover-heading">
      <div>
        <strong>求解设置</strong>
        <span>高级约束</span>
      </div>
    </div>

    <div class="settings-popover-grid">
      <label class="settings-field" for="settingsMaxOverkill">
        <span>最大超伤</span>
        <InputNumber
          input-id="settingsMaxOverkill"
          :model-value="store.maxOverkill"
          :min="0"
          :use-grouping="false"
          :max-fraction-digits="0"
          @update:model-value="setMaxOverkill"
        />
      </label>
    </div>

    <section v-if="store.options.length" class="settings-slots" aria-label="挂点限制">
      <div class="settings-section-heading">
        <div>
          <strong>挂点限制</strong>
          <small>{{ store.slotSummary }}</small>
        </div>
        <Button
          v-if="store.allowedSlots.size"
          label="清除限制"
          text
          size="small"
          @click="store.clearSlotLimit"
        />
      </div>
      <div class="slot-grid">
        <label v-for="slot in store.availableSlots" :key="slot" class="slot-checkbox checkbox-with-label">
          <Checkbox
            binary
            :model-value="store.allowedSlots.has(slot)"
            :aria-label="`允许使用挂点 P${slot}`"
            @update:model-value="store.toggleSlot(slot, Boolean($event))"
          />
          <span>P{{ slot }}</span>
        </label>
      </div>
      <p class="settings-hint">选择后仅允许使用所选挂点；不选择表示不限。</p>
    </section>
  </div>
</template>
