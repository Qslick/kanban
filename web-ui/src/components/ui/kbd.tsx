import type { ReactNode } from "react";

import { cn } from "@/components/ui/cn";

export function Kbd({ children, className }: { children: ReactNode; className?: string }): React.ReactElement {
	return (
		<kbd
			className={cn(
				"inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-sm border border-border/80 bg-surface-2 font-mono text-[11px] font-medium text-text-secondary shadow-[inset_0_-1px_0_0_rgba(0,0,0,0.25)]",
				className,
			)}
		>
			{children}
		</kbd>
	);
}
