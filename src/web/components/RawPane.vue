<script setup lang="ts">
import { computed } from 'vue';
import { splitLines } from '../../core/lines.js';
import type { CommentView, FileView } from '../../core/types.js';
import { highlightMarkdown } from '../lib/highlight.js';
import { startDraft, store, submitDraft } from '../state.js';
import { t } from '../strings.js';
import CommentCard from './CommentCard.vue';
import CommentForm from './CommentForm.vue';

const props = defineProps<{ view: FileView; comments: CommentView[] }>();

const lines = computed(() => splitLines(props.view.content));
const highlighted = computed(() => highlightMarkdown(lines.value));
const changed = computed(() => new Set(props.view.changedLines));

const byLine = computed(() => {
  const lastLine = Math.max(lines.value.length, 1);
  const map = new Map<number, CommentView[]>();
  for (const comment of props.comments) {
    const line = Math.min(comment.currentLine, lastLine);
    map.set(line, [...(map.get(line) ?? []), comment]);
  }
  return map;
});

const rows = computed(() => (lines.value.length === 0 ? [''] : lines.value));

function hasDraft(line: number): boolean {
  return store.draft?.pane === 'raw' && store.draft.line === line;
}

function setDraftText(text: string): void {
  if (store.draft !== null) store.draft.text = text;
}
</script>

<template>
  <div class="raw">
    <template v-for="(_text, index) in rows" :key="index">
      <div class="raw-line" :class="{ changed: changed.has(index + 1) }" :data-line-start="index + 1">
        <span class="raw-number">{{ index + 1 }}</span>
        <button
          v-if="lines.length > 0"
          type="button"
          class="add"
          :title="t.addComment"
          :aria-label="`${t.addComment}: ${index + 1}`"
          @click="startDraft(index + 1, 'raw')"
        >
          +
        </button>
        <span class="raw-text">
          <span
            v-for="(segment, segmentIndex) in highlighted[index] ?? []"
            :key="segmentIndex"
            :class="segment.kind === null ? undefined : `md-${segment.kind}`"
            >{{ segment.text }}</span
          >
        </span>
      </div>
      <div v-if="byLine.has(index + 1) || hasDraft(index + 1)" class="raw-comments">
        <CommentCard v-for="comment in byLine.get(index + 1)" :key="comment.id" :comment="comment" pane="raw" />
        <CommentForm
          v-if="hasDraft(index + 1)"
          :initial="store.draft?.text ?? ''"
          @change="setDraftText"
          @submit="submitDraft"
          @cancel="store.draft = null"
        />
      </div>
    </template>
  </div>
</template>
