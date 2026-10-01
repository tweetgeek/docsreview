<script setup lang="ts">
import type { CommentView } from '../../core/types.js';
import { removeComment, store, updateComment } from '../state.js';
import { t } from '../strings.js';

defineProps<{ comment: CommentView; editable?: boolean }>();
const emit = defineEmits<{ edit: [] }>();
</script>

<template>
  <div class="comment-actions">
    <button
      v-if="comment.needsCheck"
      type="button"
      :disabled="!store.connected"
      @click="updateComment(comment.id, { checked: true })"
    >
      {{ t.stillValid }}
    </button>
    <button
      v-if="comment.status === 'open'"
      type="button"
      :disabled="!store.connected"
      @click="updateComment(comment.id, { status: 'resolved' })"
    >
      {{ t.resolve }}
    </button>
    <button v-else type="button" :disabled="!store.connected" @click="updateComment(comment.id, { status: 'open' })">
      {{ t.reopen }}
    </button>
    <button v-if="editable" type="button" :disabled="!store.connected" @click="emit('edit')">{{ t.edit }}</button>
    <button type="button" :disabled="!store.connected" @click="removeComment(comment.id)">{{ t.remove }}</button>
  </div>
</template>
