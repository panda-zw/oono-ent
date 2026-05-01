import { useCallback, useRef } from "react";

export type ResizeOpts = {
  min: number;
  max: number;
  side: "left" | "right";
  value: number;
  onChange: (next: number) => void;
};

export function useResizable({ min, max, side, value, onChange }: ResizeOpts) {
  const valueRef = useRef(value);
  valueRef.current = value;

  return useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = valueRef.current;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const next = side === "right" ? startW + dx : startW - dx;
        onChange(Math.max(min, Math.min(max, next)));
      };
      const onUp = () => {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [min, max, side, onChange],
  );
}
