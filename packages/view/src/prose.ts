export type ProseRenderRequest = {
  text: string;
  container: HTMLElement;
  signal: AbortSignal;
};
export type ProseRenderer = (request: ProseRenderRequest) => void | (() => void) | Promise<void | (() => void)>;

/** Each render owns an isolated stage and resources until replacement or reset. */
export function createProseScope(renderer?: ProseRenderer, onLayout?: () => void): {
  render(container: HTMLElement, text: string): void;
  reset(): void;
  destroy(): void;
} {
  type Render = { abort: AbortController; stage: HTMLElement; cleanup?: () => void };
  const renders = new Map<HTMLElement, Render>();
  let destroyed = false;
  const dispose = (cleanup?: () => void) => {
    try { cleanup?.(); } catch { /* One host cleanup must not strand other renders. */ }
  };
  const release = (render: Render) => {
    render.abort.abort();
    dispose(render.cleanup); render.cleanup = undefined;
    render.stage.remove();
  };
  const layout = () => {
    try { onLayout?.(); } catch { /* Layout observers do not own rendered content. */ }
  };
  const reset = () => {
    const previous = [...renders];
    renders.clear();
    for (const [container, render] of previous) {
      release(render); container.replaceChildren();
    }
  };
  return {
    render(container, text) {
      if (destroyed) return;
      const previous = renders.get(container);
      renders.delete(container);
      if (previous) release(previous);
      container.textContent = text;
      const render: Render = { abort: new AbortController(), stage: container.ownerDocument.createElement("div") };
      renders.set(container, render);
      if (!renderer) return;
      const current = () => !destroyed && renders.get(container) === render;
      const finish = (cleanup: void | (() => void)) => {
        if (!current()) { dispose(cleanup || undefined); return; }
        render.cleanup = cleanup || undefined;
        container.replaceChildren(render.stage);
        layout();
      };
      const fail = () => {
        if (!current()) return;
        // A failed engine can still have pending work; retire its stage too.
        release(render);
        container.textContent = text;
        layout();
      };
      try {
        const result = renderer({ text, container: render.stage, signal: render.abort.signal });
        if (result && typeof result !== "function") void Promise.resolve(result).then(finish, fail);
        else finish(result);
      } catch { fail(); }
    },
    reset,
    destroy() {
      if (destroyed) return;
      destroyed = true; reset();
    }
  };
}
