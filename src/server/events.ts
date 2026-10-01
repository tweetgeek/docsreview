import type { ServerEvent } from '../core/types.js';

export type Listener = (event: ServerEvent) => void;

export class EventHub {
  private readonly listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: ServerEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}
