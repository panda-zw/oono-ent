import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function BackgroundGradient({
  children,
  className,
  containerClassName,
}: {
  children: ReactNode;
  className?: string;
  containerClassName?: string;
}) {
  return (
    <div
      // The card itself owns the visual chrome (border, bg, blur, radius).
      // Using `isolate` keeps the rotating gradient layer below in its own
      // stacking context, and `overflow-hidden` clips any rotation
      // overshoot. Sizing is driven by the inner content as normal — the
      // gradient is positioned absolute so it doesn't influence layout.
      className={cn(
        "relative isolate overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl",
        containerClassName,
      )}
    >
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-40 blur-3xl"
        style={{
          background:
            "conic-gradient(from 0deg, oklch(0.72 0.10 200 / 0.55), oklch(0.66 0.09 165 / 0.45), transparent 55%, oklch(0.72 0.10 200 / 0.55))",
        }}
        animate={{ rotate: 360 }}
        transition={{ duration: 36, repeat: Infinity, ease: "linear" }}
      />
      <div className={cn("relative", className)}>{children}</div>
    </div>
  );
}
