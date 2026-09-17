import { describe, expect, it } from "vitest";

import { formatCliVersion, isPersonalForkVersion, personalForkUpdateMessage } from "../../src/fork-identity";

describe("fork identity", () => {
	it("treats -qslick. versions as the personal fork", () => {
		expect(isPersonalForkVersion("0.1.71-qslick.1")).toBe(true);
		expect(isPersonalForkVersion("0.1.70")).toBe(false);
		expect(isPersonalForkVersion("0.1.70-nightly.1")).toBe(false);
	});

	it("labels CLI --version as a qslick fork", () => {
		expect(formatCliVersion("0.1.71-qslick.1")).toBe("0.1.71-qslick.1 (qslick fork)");
		expect(formatCliVersion("0.1.70")).toBe("0.1.70");
	});

	it("tells --update how to refresh the fork instead of npm", () => {
		const message = personalForkUpdateMessage("0.1.71-qslick.1");
		expect(message).toContain("0.1.71-qslick.1");
		expect(message).toContain("npm run link");
		expect(message).not.toContain("npm install -g kanban");
	});
});
