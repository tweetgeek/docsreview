<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef, watch } from 'vue';
import type { CommentView, FileView } from '../../core/types.js';
import { findBlockIndex } from '../lib/blocks.js';
import { resolveLink } from '../lib/links.js';
import { renderMarkdown } from '../lib/render.js';
import { openFile, startDraft, store, submitDraft } from '../state.js';
import { t } from '../strings.js';
import CommentCard from './CommentCard.vue';
import CommentForm from './CommentForm.vue';

interface Slot {
  key: number;
  target: HTMLElement;
  comments: CommentView[];
  draft: boolean;
}

const props = defineProps<{ view: FileView; comments: CommentView[] }>();
const emit = defineEmits<{ rendered: [] }>();

const body = ref<HTMLElement | null>(null);
const slots = shallowRef<Slot[]>([]);
const hovered = ref<{ line: number; top: number } | null>(null);
let renderedHash: string | null = null;
let generation = 0;

const draftLine = computed(() => (store.draft?.pane === 'render' ? store.draft.line : null));

const signature = computed(() =>
  JSON.stringify([props.view.contentHash, props.view.changedLines, props.comments, draftLine.value]),
);

function createSlot(block: HTMLElement): HTMLElement {
  const holder = document.createElement('div');
  holder.className = 'comment-slot';
  if (block.tagName === 'TR') {
    const row = document.createElement('tr');
    row.className = 'comment-slot-row';
    const cell = document.createElement('td');
    cell.colSpan = 99;
    cell.append(holder);
    row.append(cell);
    block.after(row);
  } else if (block.tagName === 'LI') {
    const nested = block.querySelector(':scope > ul, :scope > ol');
    if (nested === null) block.append(holder);
    else nested.before(holder);
  } else {
    block.after(holder);
  }
  return holder;
}

async function rebuild(): Promise<void> {
  const current = ++generation;
  slots.value = [];
  hovered.value = null;
  await nextTick();
  const element = body.value;
  if (element === null || current !== generation) return;

  if (renderedHash !== props.view.contentHash) {
    element.innerHTML = renderMarkdown(props.view.content);
    renderedHash = props.view.contentHash;
  } else {
    for (const old of element.querySelectorAll('.comment-slot-row, .comment-slot')) old.remove();
  }

  const blocks = [...element.querySelectorAll<HTMLElement>('[data-block]')];
  const ranges = blocks.map((block) => ({
    start: Number(block.dataset.lineStart),
    end: Number(block.dataset.lineEnd),
  }));
  const changed = new Set(props.view.changedLines);
  blocks.forEach((block, index) => {
    const range = ranges[index]!;
    let isChanged = false;
    for (let line = range.start; line <= range.end && !isChanged; line++) isChanged = changed.has(line);
    block.classList.toggle('changed', isChanged);
  });

  const byBlock = new Map<number, Slot>();
  const slotAt = (index: number): Slot => {
    let slot = byBlock.get(index);
    if (slot === undefined) {
      slot = { key: index, target: createSlot(blocks[index]!), comments: [], draft: false };
      byBlock.set(index, slot);
    }
    return slot;
  };
  for (const comment of props.comments) {
    const index = findBlockIndex(ranges, comment.currentLine);
    if (index !== -1) slotAt(index).comments.push(comment);
  }
  if (draftLine.value !== null) {
    const index = findBlockIndex(ranges, draftLine.value);
    if (index !== -1) slotAt(index).draft = true;
  }
  slots.value = [...byBlock.values()];
  await nextTick();
  if (current === generation) emit('rendered');
}

function onHover(event: MouseEvent): void {
  const target = event.target as HTMLElement;
  if (target.closest('.render-add, .comment-slot') !== null) return;
  const block = target.closest<HTMLElement>('[data-block]');
  const pane = event.currentTarget as HTMLElement;
  if (block === null) return;
  hovered.value = {
    line: Number(block.dataset.lineStart),
    top: block.getBoundingClientRect().top - pane.getBoundingClientRect().top,
  };
}

function onClick(event: MouseEvent): void {
  const link = (event.target as HTMLElement).closest('a');
  if (link === null) return;
  const target = resolveLink(props.view.path, link.getAttribute('href') ?? '');
  if (target.kind === 'external') return;
  event.preventDefault();
  if (target.kind === 'file') openFile(target.path);
}

function setDraftText(text: string): void {
  if (store.draft !== null) store.draft.text = text;
}

watch(signature, rebuild, { flush: 'post' });
onMounted(rebuild);
</script>

<template>
  <div class="render" @mouseover="onHover" @mouseleave="hovered = null">
    <button
      v-if="hovered !== null"
      type="button"
      class="add render-add"
      :style="{ top: `${hovered.top}px` }"
      :title="t.addComment"
      :aria-label="`${t.addComment}: ${hovered.line}`"
      @click="startDraft(hovered.line, 'render')"
    >
      +
    </button>
    <div ref="body" class="render-body" @click="onClick"></div>
    <Teleport v-for="slot in slots" :key="slot.key" :to="slot.target">
      <CommentCard v-for="comment in slot.comments" :key="comment.id" :comment="comment" pane="render" />
      <CommentForm
        v-if="slot.draft"
        :initial="store.draft?.text ?? ''"
        @change="setDraftText"
        @submit="submitDraft"
        @cancel="store.draft = null"
      />
    </Teleport>
  </div>
</template>
