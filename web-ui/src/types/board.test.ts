import { describe, expect, it } from "vitest";

import { getTaskAutoReviewActionLabel, getTaskAutoReviewCancelButtonLabel, getTaskVerifyStatus } from "@/types";

describe("getTaskAutoReviewActionLabel", () => {
	it("returns the expected label for each auto review mode", () => {
		expect(getTaskAutoReviewActionLabel("commit")).toBe("commit");
		expect(getTaskAutoReviewActionLabel("pr")).toBe("PR");
	});

	it("falls back to commit when the mode is missing", () => {
		expect(getTaskAutoReviewActionLabel(undefined)).toBe("commit");
	});

	it("returns the expected cancel button label for each auto review mode", () => {
		expect(getTaskAutoReviewCancelButtonLabel("commit")).toBe("Cancel Auto-commit");
		expect(getTaskAutoReviewCancelButtonLabel("pr")).toBe("Cancel Auto-PR");
	});
});

describe("getTaskVerifyStatus", () => {
	it("returns null when no verify command is set", () => {
		expect(getTaskVerifyStatus({})).toBeNull();
	});

	it("returns pending, failed, and passed labels", () => {
		expect(getTaskVerifyStatus({ verifyCommand: "npm test" })).toEqual({
			kind: "pending",
			label: "Verify pending",
		});
		expect(
			getTaskVerifyStatus({
				verifyCommand: "npm test",
				verifyResult: { ok: false, recordedAt: 1 },
			}),
		).toEqual({
			kind: "failed",
			label: "Verify failed",
		});
		expect(
			getTaskVerifyStatus({
				verifyCommand: "npm test",
				verifyResult: { ok: true, recordedAt: 1 },
			}),
		).toEqual({
			kind: "passed",
			label: "Verify passed",
		});
	});
});
