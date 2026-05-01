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
      // `isolate` forces a new stacking context so the conic gradient is
      // clipped + composited inside the card's bounds. Without it, `-z-10`
      // escapes to the page-root context and the gradient renders behind
      // the page background — i.e. invisible.
      className={cn(
        "relative isolate overflow-hidden rounded-2xl",
        containerClassName,
      )}
    >
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -top-1/2 -left-1/2 z-0 h-[200%] w-[200%] opacity-30 blur-3xl"
        style={{
          background:
            "conic-gradient(from 0deg, oklch(0.72 0.10 200 / 0.5), oklch(0.66 0.09 165 / 0.4), transparent 60%, oklch(0.72 0.10 200 / 0.5))",
        }}
        animate={{ rotate: 360 }}
        transition={{ duration: 36, repeat: Infinity, ease: "linear" }}
      />
      <div
        className={cn(
          "relative z-10 rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
