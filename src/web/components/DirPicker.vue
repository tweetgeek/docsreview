<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { DirListing } from '../../core/types.js';
import { api } from '../api.js';
import { changeRoot, store } from '../state.js';
import { t } from '../strings.js';

const emit = defineEmits<{ close: [] }>();

const listing = ref<DirListing | null>(null);
const error = ref<string | null>(null);

async function browse(path?: string): Promise<void> {
  try {
    listing.value = await api.dirs(path);
    error.value = null;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}

function child(name: string): string {
  const base = listing.value?.path ?? '';
  return base.endsWith('/') ? `${base}${name}` : `${base}/${name}`;
}

async function choose(path: string): Promise<void> {
  if (await changeRoot(path)) {
    emit('close');
  } else {
    error.value = store.error;
    store.error = null;
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close');
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  void browse(store.session?.root);
});
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal dir-picker" role="dialog" aria-modal="true" :aria-label="t.pickerTitle">
      <h2>{{ t.pickerTitle }}</h2>
      <p v-if="error !== null" class="banner error" role="alert">{{ error }}</p>
      <section v-if="(store.session?.recent.length ?? 0) > 0">
        <h3>{{ t.recent }}</h3>
        <ul class="dir-list">
          <li v-for="dir in store.session?.recent" :key="dir">
            <button type="button" @click="choose(dir)">{{ dir }}</button>
          </li>
        </ul>
      </section>
      <section v-if="listing !== null">
        <h3>{{ t.browse }}</h3>
        <p class="dir-current">{{ listing.path }}</p>
        <ul class="dir-list dir-browser">
          <li v-if="listing.parent !== null">
            <button type="button" @click="browse(listing.parent)">{{ t.parentDir }}</button>
          </li>
          <li v-for="dir in listing.dirs" :key="dir">
            <button type="button" @click="browse(child(dir))">{{ dir }}/</button>
          </li>
        </ul>
        <p v-if="listing.dirs.length === 0" class="hint">{{ t.noSubdirs }}</p>
      </section>
      <div class="modal-actions">
        <button type="button" @click="emit('close')">{{ t.cancel }}</button>
        <button type="button" class="primary" :disabled="listing === null" @click="listing && choose(listing.path)">
          {{ t.chooseThis }}
        </button>
      </div>
    </div>
  </div>
</template>
