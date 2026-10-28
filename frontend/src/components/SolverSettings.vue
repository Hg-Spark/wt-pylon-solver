<script setup lang="ts">
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


  </div>
</template>
