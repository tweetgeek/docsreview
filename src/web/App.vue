<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import CommentsView from './components/CommentsView.vue';
import DirPicker from './components/DirPicker.vue';
import FilesView from './components/FilesView.vue';
import { init, navigate, store } from './state.js';
import { t } from './strings.js';

const pickerOpen = ref(false);
const warningDismissed = ref(false);

const openCount = computed(
  () => store.comments.comments.filter((comment) => comment.status === 'open' && !comment.fileMissing).length,
);

onMounted(init);
</script>

<template>
  <div class="app">
    <header class="header">
      <strong class="app-name">{{ t.appName }}</strong>
      <nav class="tabs">
        <button type="button" :class="{ active: store.route.tab === 'files' }" @click="navigate({ tab: 'files' })">
          {{ t.tabFiles }}
        </button>
        <button
          type="button"
          :class="{ active: store.route.tab === 'comments' }"
          @click="navigate({ tab: 'comments' })"
        >
          {{ t.tabComments }} ({{ openCount }})
        </button>
      </nav>
      <span class="root" :title="store.session?.root">{{ store.session?.root }}</span>
      <button type="button" :disabled="!store.connected" @click="pickerOpen = true">{{ t.changeDir }}</button>
    </header>
    <div v-if="!store.connected" class="banner error" role="alert">{{ t.connectionLost }}</div>
    <div v-if="store.session?.warning && !warningDismissed" class="banner warning" role="alert">
      {{ store.session.warning }}
      <button type="button" @click="warningDismissed = true">{{ t.dismiss }}</button>
    </div>
    <div v-if="store.error !== null" class="banner error" role="alert">
      {{ store.error }}
      <button type="button" @click="store.error = null">{{ t.dismiss }}</button>
    </div>
    <div v-if="store.notice !== null" class="banner notice" role="status">{{ store.notice }}</div>
    <FilesView v-if="store.route.tab === 'files'" @change-dir="pickerOpen = true" />
    <CommentsView v-else />
    <DirPicker v-if="pickerOpen" @close="pickerOpen = false" />
  </div>
</template>
