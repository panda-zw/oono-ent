import { useCallback, useRef } from "react";

type Handlers = {
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
  onTouchCancel: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
};

/**
 * On touch devices a long-press (~500 ms hold without scrolling) fires
 * `onLongPress(x, y)` at the contact point. On a desktop, `onContextMenu`
 * (right-click) triggers the same callback with the cursor coords.
 *
 * `scrollSlop` defines how many pixels the finger can drift before we
 * treat the gesture as a scroll and cancel the long-press timer.
 */
export function useLongPress(
  onLongPress: (x: number, y: number) => void,
  { delay = 500, scrollSlop = 8 }: { delay?: number; scrollSlop?: number } = {},
): Handlers {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    start.current = null;
  }, []);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      start.current = { x: t.clientX, y: t.clientY };
      timer.current = window.setTimeout(() => {
        if (start.current) onLongPress(start.current.x, start.current.y);
        clear();
      }, delay);
    },
    [onLongPress, delay, clear],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!start.current) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - start.current.x;
      const dy = t.clientY - start.current.y;
      if (Math.hypot(dx, dy) > scrollSlop) clear();
    },
    [clear, scrollSlop],
  );

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onLongPress(e.clientX, e.clientY);
    },
    [onLongPress],
  );

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd: clear,
    onTouchCancel: clear,
    onContextMenu,
  };
}
