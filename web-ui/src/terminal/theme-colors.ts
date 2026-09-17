import { useMemo } from "react";

import { getTerminalThemeColors, type ThemeTerminalColors, useTheme } from "@/hooks/use-theme";

/** Static default terminal colors — preserved for backward compatibility and tests. */
export const TERMINAL_THEME_COLORS = {
	textPrimary: "#E8EEF4",
	surfacePrimary: "#151A1E",
	surfaceRaised: "#1C2126",
	selectionBackground: "#1F87B54D",
	selectionForeground: "#ffffff",
	selectionInactiveBackground: "#252B3166",
} as const;

/** React hook that returns terminal colors matching the active theme. */
export function useTerminalThemeColors(): ThemeTerminalColors {
	const { themeId } = useTheme();
	return useMemo(() => getTerminalThemeColors(themeId), [themeId]);
}
