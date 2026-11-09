import { useEffect, useRef } from 'react';

/**
 * Escape backs out of the topmost popup only: every open popup (confirmation, enhancement
 * picker, build menu, origin popout, set picker, a level reopened from the overview) registers a
 * handler while it is open, and Escape runs the most recently registered one.
 */
const stack: { id: number; run: () => void }[] = [];
let nextId = 1;

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || stack.length === 0) return;
    const t = e.target as HTMLElement | null;
    // let a focused text field clear itself first (except the pickers' own number boxes)
    if (t && t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text' && (t as HTMLInputElement).value) return;
    e.preventDefault();
    stack[stack.length - 1]!.run();
  });
}

/**
 * Register an Escape handler while `active`.
 *
 * @param handler What Escape does (close / cancel); the latest version is always used.
 * @param active Whether the popup is open.
 */
export function useEscape(handler: () => void, active = true): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    const id = nextId++;
    stack.push({ id, run: () => ref.current() });
    return () => {
      const i = stack.findIndex((x) => x.id === id);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [active]);
}
