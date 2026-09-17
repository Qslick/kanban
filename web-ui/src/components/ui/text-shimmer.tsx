import type React from "react";
import { useMemo } from "react";
import { cn } from "@/components/ui/cn";

export interface ShimmeringTextProps {
	text: string;
	duration?: number;
	delay?: number;
	repeat?: boolean;
	repeatDelay?: number;
	className?: string;
	startOnView?: boolean;
	once?: boolean;
	inViewMargin?: string;
	spread?: number;
	color?: string;
	shimmerColor?: string;
}

export function ShimmeringText({
	text,
	duration = 2.5,
	delay = 0,
	repeat = true,
	className,
	spread = 2,
	color,
	shimmerColor,
}: ShimmeringTextProps) {
	const dynamicSpread = useMemo(() => {
		return text.length * spread;
	}, [text, spread]);

	return (
		<span
			className={cn(
				"relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent kb-text-shimmer",
				"[--base-color:#8B949E] [--shimmer-color:#E6EDF3]",
				"[background-repeat:no-repeat,padding-box]",
				"[--shimmer-bg:linear-gradient(90deg,transparent_calc(50%-var(--spread)),var(--shimmer-color),transparent_calc(50%+var(--spread)))]",
				className,
			)}
			style={
				{
					"--spread": `${dynamicSpread}px`,
					...(color && { "--base-color": color }),
					...(shimmerColor && { "--shimmer-color": shimmerColor }),
					backgroundImage: "var(--shimmer-bg), linear-gradient(var(--base-color), var(--base-color))",
					animationDuration: `${duration}s`,
					animationDelay: `${delay}s`,
					animationIterationCount: repeat ? "infinite" : "1",
				} as React.CSSProperties
			}
		>
			{text}
		</span>
	);
}
