declare module "@xterm/xterm" {
	export interface ITerminalOptions {
		cols?: number;
		rows?: number;
		allowProposedApi?: boolean;
		allowTransparency?: boolean;
		altClickMovesCursor?: boolean;
		convertEol?: boolean;
		cursorBlink?: boolean;
		cursorInactiveStyle?: "outline" | "block" | "bar" | "underline" | "none";
		cursorStyle?: "block" | "underline" | "bar";
		cursorWidth?: number;
		disableStdin?: boolean;
		drawBoldTextInBrightColors?: boolean;
		fastScrollModifier?: "alt" | "ctrl" | "shift";
		fastScrollSensitivity?: number;
		fontSize?: number;
		fontFamily?: string;
		fontWeight?: "normal" | "bold" | "100" | "200" | "300" | "400" | "500" | "600" | "700" | "800" | "900" | number;
		fontWeightBold?:
			| "normal"
			| "bold"
			| "100"
			| "200"
			| "300"
			| "400"
			| "500"
			| "600"
			| "700"
			| "800"
			| "900"
			| number;
		letterSpacing?: number;
		lineHeight?: number;
		logLevel?: "trace" | "debug" | "info" | "warn" | "error" | "off";
		macOptionIsMeta?: boolean;
		macOptionClickForcesSelection?: boolean;
		minimumContrastRatio?: number;
		rightClickSelectsWord?: boolean;
		screenReaderMode?: boolean;
		scrollback?: number;
		scrollOnUserInput?: boolean;
		scrollOnEraseInDisplay?: boolean;
		scrollSensitivity?: number;
		smoothScrollDuration?: number;
		tabStopWidth?: number;
		theme?: Record<string, string>;
		windowsMode?: boolean;
		windowOptions?: Record<string, boolean>;
		wordSeparator?: string;
		overviewRulerWidth?: number;
	}

	export interface IDisposable {
		dispose(): void;
	}

	export interface IBufferCell {
		getChars(): string;
		getCode(): number;
		getWidth(): number;
	}

	export interface IBufferLine {
		length: number;
		isWrapped: boolean;
		translateToString(trimRight?: boolean, startCol?: number, endCol?: number): string;
		getCell(x: number, cell?: IBufferCell): IBufferCell | undefined;
	}

	export interface IBuffer {
		readonly cursorY: number;
		readonly cursorX: number;
		readonly length: number;
		readonly baseY: number;
		readonly viewportY: number;
		getLine(y: number): IBufferLine | undefined;
		getNullCell(): IBufferCell;
	}

	export class Terminal {
		constructor(options?: ITerminalOptions);
		readonly element?: HTMLElement;
		readonly textarea?: HTMLTextAreaElement;
		readonly rows: number;
		readonly cols: number;
		readonly unicode: {
			activeVersion: string;
		};
		readonly buffer: {
			readonly active: IBuffer;
			readonly normal: IBuffer;
			readonly alternate: IBuffer;
		};
		readonly modes: {
			readonly applicationKeypadMode?: boolean;
			readonly applicationCursorKeysMode?: boolean;
			[key: string]: unknown;
		};
		options: ITerminalOptions;
		open(parent: HTMLElement): void;
		write(data: string | Uint8Array, callback?: () => void): void;
		writeln(data: string | Uint8Array, callback?: () => void): void;
		input(data: string): void;
		paste(data: string): void;
		hasSelection(): boolean;
		getSelection(): string;
		clear(): void;
		reset(): void;
		dispose(): void;
		focus(): void;
		blur(): void;
		resize(columns: number, rows: number): void;
		loadAddon(addon: unknown): void;
		onData(callback: (data: string) => void): IDisposable;
		onBinary(callback: (data: string) => void): IDisposable;
		onKey(callback: (event: { key: string; domEvent: KeyboardEvent }) => void): IDisposable;
		onResize(callback: (event: { cols: number; rows: number }) => void): IDisposable;
		attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void;
	}
}
