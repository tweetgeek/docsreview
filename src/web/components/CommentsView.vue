<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import type { CommentView } from '../../core/types.js';
import { copyAndHandOff, removeResolved, store } from '../state.js';
import { needsCheckQuestion, t } from '../strings.js';
import CommentRow from './CommentRow.vue';

type Filter = 'open' | 'resolved' | 'all';

const filter = ref<Filter>('open');
const confirming = ref(false);
const checkGroup = ref<HTMLElement | null>(null);

const filters: Array<{ value: Filter; label: string }> = [
  { value: 'open', label: t.filterOpen },
  { value: 'resolved', label: t.filterResolved },
  { value: 'all', label: t.filterAll },
];

const filtered = computed(() =>
  store.comments.comments.filter((comment) => filter.value === 'all' || comment.status === filter.value),
);
const toCheck = computed(() => filtered.value.filter((comment) => comment.needsCheck));
const groups = computed(() => {
  const byFile = new Map<string, CommentView[]>();
  for (const comment of filtered.value) {
    if (comment.needsCheck) continue;
    byFile.set(comment.file, [...(byFile.get(comment.file) ?? []), comment]);
  }
  return [...byFile];
});
const pendingChecks = computed(() => store.comments.comments.filter((comment) => comment.needsCheck).length);
const hasResolved = computed(() => store.comments.comments.some((comment) => comment.status === 'resolved'));
const canCopy = computed(() => store.comments.output !== '' && store.connected);

async function copy(): Promise<void> {
  if (pendingChecks.value > 0 && !confirming.value) {
    confirming.value = true;
    return;
  }
  confirming.value = false;
  await copyAndHandOff();
}

async function showThem(): Promise<void> {
  confirming.value = false;
  filter.value = 'open';
  await nextTick();
  checkGroup.value?.scrollIntoView({ block: 'start' });
}
</script>

<template>
  <div class="comments-view">
    <section class="comments-list">
      <div class="toolbar">
        <div class="filters" role="group">
          <button
            v-for="option in filters"
            :key="option.value"
            type="button"
            :class="{ active: filter === option.value }"
            :aria-pressed="filter === option.value"
            @click="filter = option.value"
          >
            {{ option.label }}
          </button>
        </div>
        <button type="button" :disabled="!hasResolved || !store.connected" @click="removeResolved()">
          {{ t.removeResolved }}
        </button>
      </div>
      <div class="comments-scroll">
        <p v-if="filtered.length === 0" class="empty">{{ t.noComments }}</p>
        <div v-if="toCheck.length > 0" ref="checkGroup" class="comment-group needs-check-group">
          <h3>{{ t.groupNeedsCheck }}</h3>
          <ul>
            <CommentRow v-for="comment in toCheck" :key="comment.id" :comment="comment" />
          </ul>
        </div>
        <div v-for="[file, comments] in groups" :key="file" class="comment-group">
          <h3>{{ file }}</h3>
          <ul>
            <CommentRow v-for="comment in comments" :key="comment.id" :comment="comment" />
          </ul>
        </div>
      </div>
    </section>
    <section class="output">
      <div class="toolbar">
        <strong>{{ t.output }}</strong>
        <button type="button" class="primary" :disabled="!canCopy" @click="copy">{{ t.copy }}</button>
      </div>
      <textarea
        class="output-text"
        readonly
        :aria-label="t.output"
        :placeholder="t.noOpenComments"
        :value="store.comments.output"
      ></textarea>
    </section>
    <div v-if="confirming" class="modal-backdrop" @click.self="confirming = false">
      <div class="modal" role="dialog" aria-modal="true">
        <p>{{ needsCheckQuestion(pendingChecks) }} {{ t.copyAnyway }}</p>
        <div class="modal-actions">
          <button type="button" @click="showThem">{{ t.showThem }}</button>
          <button type="button" class="primary" @click="copy">{{ t.copy }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
