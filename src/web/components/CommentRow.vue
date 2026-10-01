<script setup lang="ts">
import type { CommentView } from '../../core/types.js';
import { openFile } from '../state.js';
import CommentActions from './CommentActions.vue';
import CommentBadges from './CommentBadges.vue';

const props = defineProps<{ comment: CommentView }>();

function open(): void {
  if (!props.comment.fileMissing) openFile(props.comment.file, props.comment.currentLine);
}
</script>

<template>
  <li class="comment-row" :class="[comment.status, { 'needs-check': comment.needsCheck }]">
    <button type="button" class="comment-row-main" :disabled="comment.fileMissing" @click="open">
      <span class="location">{{ comment.file }}:{{ comment.currentLine }}</span>
      <CommentBadges :comment="comment" />
      <span class="comment-text">{{ comment.text }}</span>
    </button>
    <CommentActions :comment="comment" />
  </li>
</template>
