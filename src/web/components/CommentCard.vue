<script setup lang="ts">
import { computed } from 'vue';
import type { CommentView } from '../../core/types.js';
import { store, updateComment, type Editing } from '../state.js';
import { t } from '../strings.js';
import CommentActions from './CommentActions.vue';
import CommentBadges from './CommentBadges.vue';
import CommentForm from './CommentForm.vue';

const props = defineProps<{ comment: CommentView; pane: Editing['pane'] }>();

const editing = computed(() => store.editing?.id === props.comment.id && store.editing.pane === props.pane);

function startEdit(): void {
  store.editing = { id: props.comment.id, pane: props.pane, text: props.comment.text };
}

function setEditText(text: string): void {
  if (editing.value) store.editing!.text = text;
}

function cancelEdit(): void {
  if (editing.value) store.editing = null;
}

async function saveEdit(text: string): Promise<void> {
  if ((await updateComment(props.comment.id, { text })) && editing.value) store.editing = null;
}
</script>

<template>
  <div class="comment" :class="[comment.status, { 'needs-check': comment.needsCheck }]">
    <CommentBadges :comment="comment" />
    <div v-if="comment.lineChanged" class="comment-was">{{ t.was }} {{ comment.previousLineText }}</div>
    <CommentForm
      v-if="editing"
      :initial="store.editing?.text ?? comment.text"
      @change="setEditText"
      @submit="saveEdit"
      @cancel="cancelEdit"
    />
    <template v-else>
      <div class="comment-text">{{ comment.text }}</div>
      <CommentActions :comment="comment" editable @edit="startEdit" />
    </template>
  </div>
</template>
