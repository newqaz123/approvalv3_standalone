import { cn } from "@/lib/utils";

/**
 * Shared gradient palette for generated avatars. Deterministic per user name:
 * the same person gets the same color on every surface (navbar, profile,
 * approval timeline, PIC column).
 */
const AVATAR_GRADIENTS = [
	"linear-gradient(135deg,#3b82f6,#2563eb)",
	"linear-gradient(135deg,#a855f7,#7c3aed)",
	"linear-gradient(135deg,#f59e0b,#d97706)",
	"linear-gradient(135deg,#10b981,#059669)",
	"linear-gradient(135deg,#ec4899,#be185d)",
	"linear-gradient(135deg,#06b6d4,#0e7490)",
] as const;

export function getAvatarGradient(key: string) {
	let hash = 0;
	for (let i = 0; i < key.length; i++) {
		hash = (hash * 31 + key.charCodeAt(i)) | 0;
	}
	return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

function getInitials(name: string) {
	return (
		name
			.trim()
			.split(" ")
			.map((part) => part[0])
			.join("")
			.slice(0, 2)
			.toUpperCase() || "?"
	);
}

const SIZE_CLASSES = {
	sm: "h-5 w-5 text-[9px]",
	md: "h-6 w-6 text-[10px]",
	lg: "h-10 w-10 text-sm",
	xl: "h-14 w-14 text-xl",
} as const;

export interface UserAvatarProps {
	/** User display name — drives both the initials and the gradient color. */
	name?: string | null;
	size?: keyof typeof SIZE_CLASSES;
	className?: string;
	/**
	 * Optional status ring around the avatar (e.g. approval state on the
	 * timeline). Omit for plain avatars. `current` gates the pulse so only the
	 * active step animates.
	 */
	status?: {
		approved?: boolean;
		pending?: boolean;
		rejected?: boolean;
		current?: boolean;
	} | null;
}

export function UserAvatar({
	name,
	size = "md",
	className,
	status = null,
}: UserAvatarProps) {
	const gradient = getAvatarGradient(name || "?");

	return (
		<span
			title={name ?? undefined}
			className={cn(
				"inline-flex select-none items-center justify-center rounded-full font-bold text-white ring-2 ring-white",
				SIZE_CLASSES[size],
				status && "ring-offset-2 ring-offset-white",
				status?.approved && "ring-emerald-400",
				status?.pending && "ring-amber-400",
				status?.rejected && "ring-red-400",
				status?.pending &&
					status?.current &&
					"animate-pulse motion-reduce:animate-none",
				className,
			)}
			style={{ background: gradient }}
		>
			{name?.trim() ? getInitials(name) : "?"}
		</span>
	);
}
