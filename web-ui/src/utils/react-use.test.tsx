import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useBooleanLocalStorageValue, useRawLocalStorageValue } from "@/utils/react-use";

const KEY = "kanban.test.toggle";

function BooleanToggle(): React.ReactElement {
	const [value, setValue] = useBooleanLocalStorageValue(KEY, false);
	return (
		<button type="button" data-value={String(value)} onClick={() => setValue((current) => !current)}>
			toggle
		</button>
	);
}

type Mode = "on" | "off";

function normalizeMode(value: string): Mode | null {
	return value === "on" || value === "off" ? value : null;
}

function RawToggle(): React.ReactElement {
	const [value, setValue] = useRawLocalStorageValue<Mode>(KEY, "off", normalizeMode);
	return (
		<button type="button" data-value={value} onClick={() => setValue((current) => (current === "on" ? "off" : "on"))}>
			toggle
		</button>
	);
}

function DoubleUpdate(): React.ReactElement {
	const [value, setValue] = useBooleanLocalStorageValue(KEY, false);
	const [rendered, setRendered] = useState(0);
	return (
		<button
			type="button"
			data-value={String(value)}
			data-renders={String(rendered)}
			onClick={() => {
				setValue((current) => !current);
				setValue((current) => !current);
				setRendered((current) => current + 1);
			}}
		>
			toggle
		</button>
	);
}

describe("local storage state hooks", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		window.localStorage.clear();
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		window.localStorage.clear();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	function button(): HTMLButtonElement {
		const element = container.querySelector("button");
		if (!element) {
			throw new Error("Expected the toggle button to render");
		}
		return element;
	}

	async function click(): Promise<void> {
		await act(async () => {
			button().click();
		});
	}

	// react-use's useLocalStorage memoizes its setter while reading state from a closure, so a
	// functional update used to see the first render's value forever: the toggle turned on and
	// then refused to turn off, stranding whatever it hid.
	it("toggles a boolean back and forth more than once per mount", async () => {
		await act(async () => {
			root.render(<BooleanToggle />);
		});
		expect(button().dataset.value).toBe("false");

		await click();
		expect(button().dataset.value).toBe("true");
		expect(window.localStorage.getItem(KEY)).toBe("true");

		await click();
		expect(button().dataset.value).toBe("false");
		expect(window.localStorage.getItem(KEY)).toBe("false");

		await click();
		expect(button().dataset.value).toBe("true");
		expect(window.localStorage.getItem(KEY)).toBe("true");
	});

	it("toggles a raw value back and forth more than once per mount", async () => {
		await act(async () => {
			root.render(<RawToggle />);
		});
		expect(button().dataset.value).toBe("off");

		await click();
		expect(button().dataset.value).toBe("on");

		await click();
		expect(button().dataset.value).toBe("off");

		await click();
		expect(button().dataset.value).toBe("on");
	});

	it("applies two functional updates in the same tick against the latest value", async () => {
		await act(async () => {
			root.render(<DoubleUpdate />);
		});

		await click();
		expect(button().dataset.value).toBe("false");
		expect(window.localStorage.getItem(KEY)).toBe("false");
	});

	it("reads an existing stored value on mount", async () => {
		window.localStorage.setItem(KEY, "true");
		await act(async () => {
			root.render(<BooleanToggle />);
		});
		expect(button().dataset.value).toBe("true");

		await click();
		expect(button().dataset.value).toBe("false");
	});
});
