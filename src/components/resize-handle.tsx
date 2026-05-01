import { useResizable, type ResizeOpts } from "@/hooks/useResizable";
import { cn } from "@/lib/utils";

export function ResizeHandle({
  className,
  ...opts
}: ResizeOpts & { className?: string }) {
  const onMouseDown = useResizable(opts);
  return (
    <div
      onMouseDown={onMouseDown}
      className={cn(
        "group relative h-full w-1.5 shrink-0 cursor-col-resize",
        className,
      )}
    >
      <div className="mx-auto h-full w-px bg-white/5 transition-colors group-hover:w-0.5 group-hover:bg-cyan-300/40" />
    </div>
  );
}
