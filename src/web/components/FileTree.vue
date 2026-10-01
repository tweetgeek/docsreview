<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { buildTree } from '../lib/tree.js';
import { setShowIgnored, store } from '../state.js';
import { t } from '../strings.js';
import FileTreeNode from './FileTreeNode.vue';

const tree = computed(() => buildTree(store.files));
const toggled = ref(new Set<string>());
const collapseIgnored = computed(() => store.files.some((file) => !file.ignored));

function storageKey(): string {
  return `docsreview-toggled:${store.session?.root ?? ''}`;
}

function load(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey()) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []);
  } catch {
    return new Set();
  }
}

function toggle(path: string): void {
  const next = new Set(toggled.value);
  if (!next.delete(path)) next.add(path);
  toggled.value = next;
  try {
    localStorage.setItem(storageKey(), JSON.stringify([...next]));
  } catch {
    // collapsing still works for this page view without storage
  }
}

function onShowIgnored(event: Event): void {
  void setShowIgnored((event.target as HTMLInputElement).checked);
}

watch(
  () => store.session?.root,
  () => {
    toggled.value = load();
  },
  { immediate: true },
);
</script>

<template>
  <div class="tree">
    <label class="tree-toggle">
      <input
        type="checkbox"
        :checked="store.session?.showIgnored ?? false"
        :disabled="!store.connected"
        @change="onShowIgnored"
      />
      {{ t.showIgnored }}
    </label>
    <ul class="tree-list tree-root">
      <FileTreeNode
        v-for="node in tree"
        :key="node.path"
        :node="node"
        :toggled="toggled"
        :collapse-ignored="collapseIgnored"
        @toggle="toggle"
      />
    </ul>
  </div>
</template>
