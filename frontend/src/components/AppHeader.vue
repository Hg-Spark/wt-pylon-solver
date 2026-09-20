<script setup lang="ts">
import {computed, ref} from "vue";
import Button from "primevue/button";
import Message from "primevue/message";
import Popover from "primevue/popover";
import Tag from "primevue/tag";
import {useLoadoutStore} from "../stores/loadout";
import SolverSettings from "./SolverSettings.vue";

const store = useLoadoutStore();
const settings = ref<{toggle: (event: Event) => void} | null>(null);

const statusSeverity = computed<"success" | "warn" | "danger" | "info" | "secondary">(() => {
  if (store.statusTone === "success") return "success";
  if (store.statusTone === "warning") return "warn";
  if (store.statusTone === "error") return "danger";
  if (store.statusTone === "busy") return "info";
  return "secondary";
});

function toggleSettings(event: Event): void {
  settings.value?.toggle(event);
}
</script>

<template>
  <header class="app-header">
    <div class="brandbar">
      <div class="brand-block">
        <div class="brand-mark" aria-hidden="true">WT</div>
        <div>
          <div class="eyebrow">LOADOUT SOLVER</div>
          <h1>wt-pylon-solver</h1>
        </div>
      </div>

      <div class="header-actions">
        <Button
          label="设置"
          severity="secondary"
          outlined
          aria-haspopup="true"
          @click="toggleSettings"
        />
        <Popover ref="settings" class="solver-settings-overlay">
          <SolverSettings />
        </Popover>
        <Tag :severity="statusSeverity" :value="store.statusLabel" rounded />
      </div>
    </div>

    <Message v-if="store.errorMessage" class="global-alert" severity="error" :closable="false">
      {{ store.errorMessage }}
    </Message>
  </header>
</template>
