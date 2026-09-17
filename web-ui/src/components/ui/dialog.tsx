import * as RadixAlertDialog from "@radix-ui/react-alert-dialog";
import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { type ComponentPropsWithoutRef, type ElementRef, forwardRef, type ReactNode } from "react";

import { cn } from "@/components/ui/cn";

/* ------------------------------------------------------------------ */
/* Dialog                                                              */
/* ------------------------------------------------------------------ */

export function Dialog({
	open,
	onOpenChange,
	children,
	contentClassName,
	contentAriaDescribedBy,
	onEscapeKeyDown,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	children: ReactNode;
	contentClassName?: string;
	contentAriaDescribedBy?: string;
	onEscapeKeyDown?: (event: KeyboardEvent) => void;
}): React.ReactElement {
	return (
		<RadixDialog.Root open={open} onOpenChange={onOpenChange}>
			<RadixDialog.Portal>
				<RadixDialog.Overlay className="kb-overlay fixed inset-0 z-50 bg-black/60 backdrop-blur-xs touch-none" />
				<RadixDialog.Content
					aria-describedby={contentAriaDescribedBy}
					onEscapeKeyDown={onEscapeKeyDown}
					className={cn(
						"kb-dialog-content fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-lg max-h-[85vh] flex flex-col rounded-xl border border-border-bright bg-surface-1 shadow-2xl shadow-black/60 ring-1 ring-white/5 focus:outline-none",
						contentClassName,
					)}
				>
					{children}
				</RadixDialog.Content>
			</RadixDialog.Portal>
		</RadixDialog.Root>
	);
}

export function DialogHeader({
	title,
	icon,
	children,
}: {
	title: string;
	icon?: ReactNode;
	children?: ReactNode;
}): React.ReactElement {
	return (
		<div className="flex items-center justify-between px-3.5 py-2.5 max-md:px-3 max-md:py-3 bg-surface-2/80 border-b border-border shrink-0 rounded-t-xl">
			<RadixDialog.Title className="flex items-center gap-2 text-sm font-semibold tracking-[-0.01em] text-text-primary">
				{icon ? <span className="text-text-secondary">{icon}</span> : null}
				{title}
			</RadixDialog.Title>
			{children}
			<RadixDialog.Close className="kb-btn p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-3 cursor-pointer max-md:min-h-11 max-md:min-w-11 max-md:flex max-md:items-center max-md:justify-center focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-border-focus">
				<X size={16} className="max-md:hidden" />
				<X size={20} className="hidden max-md:block" />
			</RadixDialog.Close>
		</div>
	);
}

export function DialogBody({ children, className }: { children: ReactNode; className?: string }): React.ReactElement {
	return (
		<div className={cn("p-4 overflow-y-auto overscroll-contain flex-1 min-h-0 bg-surface-1", className)}>
			{children}
		</div>
	);
}

export function DialogFooter({ children, className }: { children: ReactNode; className?: string }): React.ReactElement {
	return (
		<div
			className={cn(
				"flex items-center justify-end gap-2 px-3.5 py-2.5 max-md:px-3 max-md:py-3 bg-surface-2/60 border-t border-border shrink-0 rounded-b-xl",
				className,
			)}
		>
			{children}
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* Alert Dialog                                                       */
/* ------------------------------------------------------------------ */

export function AlertDialog({
	open,
	onOpenChange,
	children,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	children: ReactNode;
}): React.ReactElement {
	return (
		<RadixAlertDialog.Root open={open} onOpenChange={onOpenChange}>
			<RadixAlertDialog.Portal>
				<RadixAlertDialog.Overlay className="kb-overlay fixed inset-0 z-50 bg-black/60 backdrop-blur-xs touch-none" />
				<RadixAlertDialog.Content className="kb-dialog-content fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[90vw] max-w-md flex-col rounded-xl border border-border-bright bg-surface-1 shadow-2xl shadow-black/60 ring-1 ring-white/5 focus:outline-none">
					{children}
				</RadixAlertDialog.Content>
			</RadixAlertDialog.Portal>
		</RadixAlertDialog.Root>
	);
}

export function AlertDialogHeader({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}): React.ReactElement {
	return (
		<div
			className={cn(
				"px-3.5 py-2.5 max-md:px-3 max-md:py-3 bg-surface-2/80 border-b border-border shrink-0 rounded-t-xl",
				className,
			)}
		>
			{children}
		</div>
	);
}

export function AlertDialogBody({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}): React.ReactElement {
	return (
		<div
			className={cn(
				"flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain bg-surface-1 p-4 text-[13px] text-text-secondary",
				className,
			)}
		>
			{children}
		</div>
	);
}

export function AlertDialogFooter({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}): React.ReactElement {
	return (
		<div
			className={cn(
				"flex items-center justify-end gap-2 px-3.5 py-2.5 max-md:px-3 max-md:py-3 bg-surface-2/60 border-t border-border shrink-0 rounded-b-xl",
				className,
			)}
		>
			{children}
		</div>
	);
}

export const AlertDialogTitle = forwardRef<
	ElementRef<typeof RadixAlertDialog.Title>,
	ComponentPropsWithoutRef<typeof RadixAlertDialog.Title>
>(function AlertDialogTitle({ className, ...props }, ref) {
	return (
		<RadixAlertDialog.Title
			ref={ref}
			className={cn("text-sm font-semibold text-text-primary", className)}
			{...props}
		/>
	);
});

export const AlertDialogDescription = forwardRef<
	ElementRef<typeof RadixAlertDialog.Description>,
	ComponentPropsWithoutRef<typeof RadixAlertDialog.Description>
>(function AlertDialogDescription({ className, ...props }, ref) {
	return (
		<RadixAlertDialog.Description ref={ref} className={cn("text-[13px] text-text-secondary", className)} {...props} />
	);
});

export const AlertDialogAction = RadixAlertDialog.Action;
export const AlertDialogCancel = RadixAlertDialog.Cancel;
