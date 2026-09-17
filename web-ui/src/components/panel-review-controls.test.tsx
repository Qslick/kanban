import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PanelReviewFamilyChips, togglePanelReviewFamily } from "@/components/panel-review-controls";

describe("togglePanelReviewFamily", () => {
	it("adds, removes, and can keep at least one family", () => {
		expect(togglePanelReviewFamily(["grok"], "claude", false)).toEqual(["grok", "claude"]);
		expect(togglePanelReviewFamily(["grok", "claude"], "grok", false)).toEqual(["claude"]);
		expect(togglePanelReviewFamily(["grok"], "grok", true)).toEqual(["grok"]);
	});
});

describe("PanelReviewFamilyChips", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("renders labeled family chips", async () => {
		await act(async () => {
			root.render(<PanelReviewFamilyChips families={["grok", "gpt"]} onChange={() => {}} />);
		});
		const group = container.querySelector('[aria-label="Panel review families"]');
		expect(group).not.toBeNull();
		const grok = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === "Grok",
		);
		const claude = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === "Claude",
		);
		expect(grok?.getAttribute("aria-pressed")).toBe("true");
		expect(claude?.getAttribute("aria-pressed")).toBe("false");
	});
});
