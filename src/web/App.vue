<script setup lang="ts">
import { onMounted } from 'vue';
import FilesView from './components/FilesView.vue';
import { init, store } from './state.js';
import { t } from './strings.js';

onMounted(init);
</script>

<template>
  <div class="app">
    <header class="header">
      <strong class="app-name">{{ t.appName }}</strong>
      <span class="root" :title="store.session?.root">{{ store.session?.root }}</span>
    </header>
    <div v-if="!store.connected" class="banner error" role="alert">{{ t.connectionLost }}</div>
    <div v-if="store.error !== null" class="banner error" role="alert">
      {{ store.error }}
      <button type="button" @click="store.error = null">{{ t.dismiss }}</button>
    </div>
    <FilesView />
  </div>
</template>
