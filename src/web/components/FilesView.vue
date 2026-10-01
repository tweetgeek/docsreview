<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { scrollToLine, syncScroll } from '../lib/scrollSync.js';
import { store } from '../state.js';
import { t } from '../strings.js';
import FileTree from './FileTree.vue';
import RawPane from './RawPane.vue';
import RenderPane from './RenderPane.vue';

const emit = defineEmits<{ 'change-dir': [] }>();

const rawScroll = ref<HTMLElement | null>(null);
const renderScroll = ref<HTMLElement | null>(null);
let stopSync: (() => void) | null = null;

const visibleComments = computed(() =>
  (store.fileView?.comments ?? []).filter((comment) => store.showResolved || comment.status === 'open'),
);

function applyFocus(clear: boolean): void {
  const line = store.focusLine;
  if (line === null) return;
  if (rawScroll.value !== null) scrollToLine(rawScroll.value, line);
  if (renderScroll.value !== null) scrollToLine(renderScroll.value, line);
  if (clear) store.focusLine = null;
}

watch(
  [rawScroll, renderScroll],
  ([raw, render]) => {
    stopSync?.();
    stopSync = raw !== null && render !== null ? syncScroll(raw, render) : null;
  },
  { flush: 'post' },
);

watch(
  () => [store.fileView?.contentHash, store.focusLine] as const,
  async () => {
    await nextTick();
    applyFocus(store.fileView?.tooLarge === true);
  },
  { flush: 'post', immediate: true },
);

onBeforeUnmount(() => stopSync?.());
</script>

<template>
  <div class="files-view">
    <aside class="sidebar">
      <FileTree />
    </aside>
    <section class="main">
      <div v-if="store.files.length === 0" class="empty">
        <p>{{ t.noFiles }}</p>
        <p class="hint">{{ t.noFilesHint }}</p>
        <button type="button" @click="emit('change-dir')">{{ t.changeDir }}</button>
      </div>
      <div v-else-if="store.fileError !== null" class="empty">{{ store.fileError }}</div>
      <div v-else-if="store.fileView === null" class="empty">{{ t.selectFile }}</div>
      <template v-else>
        <div class="toolbar">
          <span class="file-path">{{ store.fileView.path }}</span>
          <label>
            <input v-model="store.showResolved" type="checkbox" />
            {{ t.showResolved }}
          </label>
        </div>
        <div v-if="store.fileView.tooLarge" class="banner warning">{{ t.tooLarge }}</div>
        <div class="panes">
          <div class="pane">
            <div class="pane-title">{{ t.raw }}</div>
            <div ref="rawScroll" class="pane-scroll" data-pane="raw">
              <RawPane :view="store.fileView" :comments="visibleComments" />
            </div>
          </div>
          <div v-if="!store.fileView.tooLarge" class="pane">
            <div class="pane-title">{{ t.render }}</div>
            <div ref="renderScroll" class="pane-scroll" data-pane="render">
              <RenderPane :view="store.fileView" :comments="visibleComments" @rendered="applyFocus(true)" />
            </div>
          </div>
        </div>
      </template>
    </section>
  </div>
</template>
