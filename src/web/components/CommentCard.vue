<script setup lang="ts">
import { ref } from 'vue';
import type { CommentView } from '../../core/types.js';
import { updateComment } from '../state.js';
import { t } from '../strings.js';
import CommentActions from './CommentActions.vue';
import CommentBadges from './CommentBadges.vue';
import CommentForm from './CommentForm.vue';

const props = defineProps<{ comment: CommentView }>();
const editing = ref(false);

async function saveEdit(text: string): Promise<void> {
  if (await updateComment(props.comment.id, { text })) editing.value = false;
}
</script>

<template>
  <div class="comment" :class="[comment.status, { 'needs-check': comment.needsCheck }]">
    <CommentBadges :comment="comment" />
    <div v-if="comment.lineChanged" class="comment-was">{{ t.was }} {{ comment.previousLineText }}</div>
    <CommentForm v-if="editing" :initial="comment.text" @submit="saveEdit" @cancel="editing = false" />
    <template v-else>
      <div class="comment-text">{{ comment.text }}</div>
      <CommentActions :comment="comment" editable @edit="editing = true" />
    </template>
  </div>
</template>
