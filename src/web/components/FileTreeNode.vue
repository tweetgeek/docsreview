<script setup lang="ts">
import { computed } from 'vue';
import type { TreeNode } from '../lib/tree.js';
import { openFile, store } from '../state.js';
import { t } from '../strings.js';

const props = defineProps<{ node: TreeNode; toggled: Set<string>; collapseIgnored: boolean }>();
const emit = defineEmits<{ toggle: [path: string] }>();

const collapsedByDefault = computed(
  () => props.collapseIgnored && props.node.ignored && props.node.openComments === 0,
);
const collapsed = computed(() => props.toggled.has(props.node.path) !== collapsedByDefault.value);
</script>

<template>
  <li v-if="node.file === null" class="tree-dir" :class="{ ignored: node.ignored }">
    <button type="button" class="tree-row" :aria-expanded="!collapsed" @click="emit('toggle', node.path)">
      <span class="tree-arrow">{{ collapsed ? '▸' : '▾' }}</span>
      <span class="tree-name">{{ node.name }}/</span>
      <span v-if="collapsed && node.openComments > 0" class="count">{{ node.openComments }}</span>
    </button>
    <ul v-if="!collapsed" class="tree-list">
      <FileTreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :toggled="toggled"
        :collapse-ignored="collapseIgnored"
        @toggle="emit('toggle', $event)"
      />
    </ul>
  </li>
  <li v-else class="tree-file" :class="{ ignored: node.ignored, active: store.route.file === node.path }">
    <button type="button" class="tree-row" :title="node.path" @click="openFile(node.path)">
      <span class="tree-name">{{ node.name }}</span>
      <span v-if="node.file.roundStatus === 'changed'" class="badge round-changed">{{ t.statusChanged }}</span>
      <span v-if="node.file.roundStatus === 'new'" class="badge round-new">{{ t.statusNew }}</span>
      <span v-if="node.file.openComments > 0" class="count">{{ node.file.openComments }}</span>
    </button>
  </li>
</template>
