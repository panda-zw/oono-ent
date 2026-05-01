import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export function Spotlight({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      el.style.setProperty("--spotlight-x", `${x}%`);
      el.style.setProperty("--spotlight-y", `${y}%`);
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className={cn(
        "pointer-events-none fixed inset-0 z-0",
        "bg-[radial-gradient(600px_circle_at_var(--spotlight-x,50%)_var(--spotlight-y,50%),oklch(0.6_0.14_200/0.18),transparent_60%)]",
        className,
      )}
    />
  );
}
