<script setup lang="ts">
import AppHeader from "./components/AppHeader.vue";
import OptionLibrary from "./components/OptionLibrary.vue";
import ResultsPanel from "./components/ResultsPanel.vue";
</script>

<template>
  <div class="app-shell">
    <AppHeader />

    <main class="workspace-layout">
      <div class="workspace-grid">
        <OptionLibrary />
        <ResultsPanel />
      </div>
    </main>
  </div>
</template>
