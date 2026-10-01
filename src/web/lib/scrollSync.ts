const SUPPRESS_MS = 150;
const LINE_SELECTOR = '.raw-line, [data-block]';

function lineElements(pane: HTMLElement): HTMLElement[] {
  return [...pane.querySelectorAll<HTMLElement>(LINE_SELECTOR)];
}

export function topLine(pane: HTMLElement): number | null {
  const edge = pane.getBoundingClientRect().top + 1;
  let crossing: number | null = null;
  let below: number | null = null;
  for (const element of lineElements(pane)) {
    const rect = element.getBoundingClientRect();
    const start = Number(element.dataset.lineStart);
    if (rect.top <= edge && rect.bottom > edge) {
      if (crossing === null || start > crossing) crossing = start;
    } else if (rect.top > edge && below === null) {
      below = start;
    }
  }
  return crossing ?? below;
}

export function scrollToLine(pane: HTMLElement, line: number): void {
  let target: HTMLElement | null = null;
  let bestStart = -1;
  for (const element of lineElements(pane)) {
    const start = Number(element.dataset.lineStart);
    if (start <= line && start >= bestStart) {
      target = element;
      bestStart = start;
    }
  }
  if (target === null) return;
  pane.scrollTop += target.getBoundingClientRect().top - pane.getBoundingClientRect().top;
}

function follow(source: HTMLElement, target: HTMLElement): void {
  const sourceMax = source.scrollHeight - source.clientHeight;
  if (source.scrollTop <= 0) {
    target.scrollTop = 0;
  } else if (source.scrollTop >= sourceMax - 1) {
    target.scrollTop = target.scrollHeight - target.clientHeight;
  } else {
    const line = topLine(source);
    if (line !== null) scrollToLine(target, line);
  }
}

export function syncScroll(first: HTMLElement, second: HTMLElement): () => void {
  let suppressed: HTMLElement | null = null;
  let timer: number | null = null;

  const listener = (source: HTMLElement, target: HTMLElement) => (): void => {
    if (suppressed === source) return;
    suppressed = target;
    if (timer !== null) clearTimeout(timer);
    timer = window.setTimeout(() => {
      suppressed = null;
    }, SUPPRESS_MS);
    follow(source, target);
  };

  const onFirst = listener(first, second);
  const onSecond = listener(second, first);
  first.addEventListener('scroll', onFirst, { passive: true });
  second.addEventListener('scroll', onSecond, { passive: true });
  return () => {
    first.removeEventListener('scroll', onFirst);
    second.removeEventListener('scroll', onSecond);
    if (timer !== null) clearTimeout(timer);
  };
}
