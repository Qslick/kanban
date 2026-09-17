import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from "react";

import { cn } from "@/components/ui/cn";

export type ButtonVariant = "default" | "primary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: ButtonVariant;
	size?: ButtonSize;
	icon?: ReactNode;
	iconRight?: ReactNode;
	fill?: boolean;
}

const variantStyles: Record<ButtonVariant, string> = {
	default:
		"bg-surface-2 border border-border-bright text-text-primary shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_1px_2px_0_rgba(0,0,0,0.2)] hover:bg-surface-3 hover:border-border-bright hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08),0_1px_3px_0_rgba(0,0,0,0.3)] active:bg-surface-4 active:scale-[0.98] transition-all duration-150",
	primary:
		"bg-accent text-accent-fg border border-transparent shadow-[inset_0_1px_0_0_rgba(255,255,255,0.25),0_1px_3px_0_rgba(0,0,0,0.3)] hover:bg-accent-hover hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.3),0_2px_5px_0_rgba(0,0,0,0.35)] active:brightness-95 active:scale-[0.98] transition-all duration-150",
	danger:
		"bg-status-red/10 text-status-red border border-status-red/30 hover:bg-status-red/20 active:bg-status-red/30 active:scale-[0.98] transition-all duration-150",
	ghost: "bg-transparent text-text-secondary border border-transparent hover:text-text-primary hover:bg-surface-3 active:bg-surface-4 active:scale-[0.98] transition-all duration-150",
};

const sizeStyles: Record<ButtonSize, string> = {
	sm: "h-7 px-2 text-xs gap-1.5",
	md: "h-8 px-3 text-[13px] gap-2",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
	{ variant = "default", size = "md", icon, iconRight, fill, children, className, disabled, ...props },
	ref,
) {
	const iconOnly = !children && !!(icon || iconRight);
	const buttonType = props.type ?? "button";

	return (
		<button
			ref={ref}
			type={buttonType}
			className={cn(
				"inline-flex items-center justify-center rounded-md font-medium cursor-pointer select-none",
				"disabled:opacity-40 disabled:pointer-events-none",
				"focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent",
				variantStyles[variant],
				sizeStyles[size],
				fill && "w-full",
				iconOnly && "px-0 aspect-square",
				className,
			)}
			disabled={disabled}
			{...props}
		>
			{icon}
			{children}
			{iconRight}
		</button>
	);
});
