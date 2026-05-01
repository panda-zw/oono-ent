import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function BentoGrid({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-3 @md:grid-cols-2 @2xl:grid-cols-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function BentoCard({
  title,
  description,
  icon,
  className,
  onClick,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <motion.button
      whileHover={{ y: -2 }}
      onClick={onClick}
      className={cn(
        "group relative flex min-h-32 flex-col justify-between gap-3 overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-4 text-left backdrop-blur-xl transition-colors hover:border-white/25 hover:bg-white/10",
        className,
      )}
    >
      <div
        className="absolute inset-0 -z-10 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(400px circle at var(--mx,50%) var(--my,50%), oklch(0.7 0.14 200 / 0.25), transparent 60%)",
        }}
      />
      {icon && (
        <div className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white/80">
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <h3 className="truncate text-base font-semibold text-white">{title}</h3>
        {description && (
          <p className="mt-1 line-clamp-2 text-xs text-white/60">{description}</p>
        )}
      </div>
    </motion.button>
  );
}
