<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { t } from '../strings.js';

const props = defineProps<{ initial: string }>();
const emit = defineEmits<{ submit: [text: string]; cancel: []; change: [text: string] }>();

const text = ref(props.initial);
const area = ref<HTMLTextAreaElement | null>(null);

onMounted(() => area.value?.focus());

function submit(): void {
  if (text.value.trim() !== '') emit('submit', text.value);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    submit();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    emit('cancel');
  }
}
</script>

<template>
  <div class="comment-form">
    <textarea
      ref="area"
      v-model="text"
      rows="3"
      :placeholder="t.commentPlaceholder"
      :aria-label="t.commentPlaceholder"
      @input="emit('change', text)"
      @keydown="onKeydown"
    ></textarea>
    <div class="comment-form-actions">
      <span class="hint">{{ t.saveHint }}</span>
      <button type="button" @click="emit('cancel')">{{ t.cancel }}</button>
      <button type="button" class="primary" :disabled="text.trim() === ''" @click="submit">{{ t.save }}</button>
    </div>
  </div>
</template>
