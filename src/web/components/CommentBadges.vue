<script setup lang="ts">
import type { CommentView } from '../../core/types.js';
import { t } from '../strings.js';

defineProps<{ comment: CommentView }>();
</script>

<template>
  <span class="badges">
    <span class="badge" :class="comment.status">{{ comment.status === 'open' ? t.open : t.resolved }}</span>
    <span v-if="comment.handedOff" class="badge handed-off">{{ t.handedOff }}</span>
    <span v-if="comment.lineChanged" class="badge line-changed">{{ t.lineChanged }}</span>
    <span v-if="comment.needsCheck" class="badge needs-check">{{ t.needsCheck }}</span>
    <span v-if="comment.fileMissing" class="badge missing">{{ t.missingFile }}</span>
  </span>
</template>
