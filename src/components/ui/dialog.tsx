"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/*
 * Bridges Dialog root's onOpenChange to DialogContent so the mobile drag
 * handle can close the sheet programmatically after a downward swipe.
 */
const DialogCloseContext = React.createContext<() => void>(() => {});

const Dialog = (props: React.ComponentProps<typeof DialogPrimitive.Root>) => (
	<DialogCloseContext.Provider value={() => props.onOpenChange?.(false)}>
		<DialogPrimitive.Root {...props} />
	</DialogCloseContext.Provider>
);

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Overlay>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
	<DialogPrimitive.Overlay
		ref={ref}
		className={cn(
			"fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
			className,
		)}
		{...props}
	/>
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => {
	const closeSheet = React.useContext(DialogCloseContext);
	const touchStartY = React.useRef<number | null>(null);
	const touchMovedRef = React.useRef(false);

	return (
		<DialogPortal>
			<DialogOverlay />
			<DialogPrimitive.Content
				ref={ref}
				className={cn(
					"fixed inset-x-0 bottom-0 z-50 grid max-h-[92svh] pointer-coarse:max-h-[92svh] w-full max-w-lg gap-4 overflow-x-hidden overflow-y-auto overscroll-contain rounded-t-2xl pointer-fine:rounded-2xl border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom pointer-fine:inset-x-auto pointer-fine:bottom-auto pointer-fine:left-1/2 pointer-fine:top-1/2 pointer-fine:-translate-x-1/2 pointer-fine:-translate-y-1/2 pointer-fine:data-[state=closed]:slide-out-to-left-1/2 pointer-fine:data-[state=closed]:slide-out-to-top-[48%] pointer-fine:data-[state=open]:slide-in-from-left-1/2 pointer-fine:data-[state=open]:slide-in-from-top-[48%]",
					className,
				)}
				{...props}
			>
				<div
					aria-hidden="true"
					className="absolute left-1/2 top-1 z-30 flex h-8 w-20 -translate-x-1/2 touch-none items-center justify-center rounded-full pointer-events-auto pointer-fine:hidden"
					onTouchStart={(e) => {
						touchStartY.current = e.touches[0]?.clientY ?? null;
						touchMovedRef.current = false;
					}}
					onTouchMove={(e) => {
						const start = touchStartY.current;
						const current = e.touches[0]?.clientY;
						if (
							start !== null &&
							current !== undefined &&
							current - start > 8
						) {
							touchMovedRef.current = true;
						}
					}}
					onTouchEnd={(e) => {
						const start = touchStartY.current;
						const moved = touchMovedRef.current;
						touchStartY.current = null;
						touchMovedRef.current = false;
						// Drag-down only: a bare touch/tap, or a Safari toolbar
						// coordinate change without touchmove, never closes the sheet.
						if (
							start !== null &&
							moved &&
							e.changedTouches[0].clientY - start > 60
						) {
							closeSheet();
						}
					}}
				>
					<span className="h-1.5 w-10 rounded-full bg-slate-300" />
				</div>
				{children}
				<DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
					<X className="h-4 w-4" />
					<span className="sr-only">Close</span>
				</DialogPrimitive.Close>
			</DialogPrimitive.Content>
		</DialogPortal>
	);
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({
	className,
	...props
}: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn(
			"flex flex-col space-y-1.5 text-center sm:text-left",
			className,
		)}
		{...props}
	/>
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({
	className,
	...props
}: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn(
			"flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
			className,
		)}
		{...props}
	/>
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Title>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
	<DialogPrimitive.Title
		ref={ref}
		className={cn(
			"text-lg font-semibold leading-none tracking-tight",
			className,
		)}
		{...props}
	/>
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Description>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
	<DialogPrimitive.Description
		ref={ref}
		className={cn("text-sm text-muted-foreground", className)}
		{...props}
	/>
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
	Dialog,
	DialogPortal,
	DialogOverlay,
	DialogTrigger,
	DialogClose,
	DialogContent,
	DialogHeader,
	DialogFooter,
	DialogTitle,
	DialogDescription,
};
