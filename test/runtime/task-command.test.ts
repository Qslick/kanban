import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	addTaskDependencies,
	buildTaskAgentSettingsForCreate,
	buildTaskAgentSettingsForUpdate,
	formatAgentIdOptionHelp,
	formatTaskAgentSettings,
	parseTaskIdList,
	registerTaskCommand,
	resolveSettingsFlag,
	resolveTaskLinkBlockerIds,
	shouldWarnOnExplicitAgentId,
	warnOnAgentSettingsMechanismGaps,
} from "../../src/commands/task";
import {
	type RuntimeBoardData,
	type RuntimeTaskAgentSettings,
	runtimeAgentIdSchema,
} from "../../src/core/api-contract";
import {
	addTaskToColumn,
	getUnfinishedPrerequisiteTaskIds,
	moveTaskToColumn,
	trashTaskAndGetReadyLinkedTaskIds,
} from "../../src/core/task-board-mutations";

describe("buildTaskAgentSettingsForCreate", () => {
	it("returns undefined when no settings fields are provided", () => {
		expect(buildTaskAgentSettingsForCreate({})).toBeUndefined();
	});

	it("stores opaque values verbatim without validation", () => {
		expect(
			buildTaskAgentSettingsForCreate({
				providerId: "moonshot",
				modelId: "kimi-k2-0905-preview",
				reasoningEffort: "ultracode",
			}),
		).toEqual({
			providerId: "moonshot",
			modelId: "kimi-k2-0905-preview",
			reasoningEffort: "ultracode",
		});
	});

	it("treats inherit (null) reasoning effort as no explicit override", () => {
		expect(buildTaskAgentSettingsForCreate({ reasoningEffort: null })).toBeUndefined();
	});

	it("treats default reasoning effort as an empty override marker", () => {
		expect(buildTaskAgentSettingsForCreate({ reasoningEffort: "default" })).toEqual({});
	});

	it("treats blank provider/model values as unset", () => {
		expect(buildTaskAgentSettingsForCreate({ providerId: "  ", modelId: "" })).toBeUndefined();
	});
});

describe("buildTaskAgentSettingsForUpdate", () => {
	const CURRENT: RuntimeTaskAgentSettings = {
		providerId: "anthropic",
		modelId: "claude-sonnet-4-20250514",
		reasoningEffort: "high",
	};

	it("returns undefined when no settings fields are provided", () => {
		expect(buildTaskAgentSettingsForUpdate(CURRENT, {})).toBeUndefined();
	});

	it("merges new values over current settings", () => {
		expect(
			buildTaskAgentSettingsForUpdate(CURRENT, {
				modelId: "new-model",
				reasoningEffort: "ultrathink",
			}),
		).toEqual({
			providerId: "anthropic",
			modelId: "new-model",
			reasoningEffort: "ultrathink",
		});
	});

	it("clears a field with null/default and keeps the empty-override marker", () => {
		expect(
			buildTaskAgentSettingsForUpdate(
				{ modelId: "old-model" },
				{
					modelId: null,
					reasoningEffort: "default",
				},
			),
		).toEqual({});
	});

	it("clears everything with null/inherit and returns null", () => {
		expect(
			buildTaskAgentSettingsForUpdate(CURRENT, {
				providerId: null,
				modelId: null,
				reasoningEffort: null,
			}),
		).toBeNull();
	});

	it("accepts arbitrary effort strings on update (opacity proof)", () => {
		expect(buildTaskAgentSettingsForUpdate(undefined, { reasoningEffort: "MAXIMUM_OVERDRIVE" })).toEqual({
			reasoningEffort: "MAXIMUM_OVERDRIVE",
		});
	});
});

describe("shouldWarnOnExplicitAgentId", () => {
	it("is true only when the command names an agent", () => {
		expect(shouldWarnOnExplicitAgentId("kiro")).toBe(true);
		expect(shouldWarnOnExplicitAgentId(undefined)).toBe(false);
		expect(shouldWarnOnExplicitAgentId(null)).toBe(false);
	});
});

describe("warnOnAgentSettingsMechanismGaps", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	function captureStderr(): ReturnType<typeof vi.fn> {
		return vi.spyOn(process.stderr, "write").mockImplementation(() => true);
	}

	it("writes no warning when settings are absent", () => {
		const write = captureStderr();
		warnOnAgentSettingsMechanismGaps("kiro", undefined);
		expect(write).not.toHaveBeenCalled();
	});

	it("writes no warning for agents that support the set fields", () => {
		const write = captureStderr();
		warnOnAgentSettingsMechanismGaps("claude", { modelId: "m", reasoningEffort: "high" });
		warnOnAgentSettingsMechanismGaps("codex", { modelId: "m", reasoningEffort: "high" });
		warnOnAgentSettingsMechanismGaps("droid", { modelId: "m", reasoningEffort: "high" });
		warnOnAgentSettingsMechanismGaps("cline", { providerId: "anthropic", modelId: "m", reasoningEffort: "high" });
		warnOnAgentSettingsMechanismGaps("opencode", { providerId: "openrouter", modelId: "m" });
		expect(write).not.toHaveBeenCalled();
	});

	it("warns when kiro receives model, effort, or provider settings", () => {
		const write = captureStderr();
		warnOnAgentSettingsMechanismGaps("kiro", {
			providerId: "anthropic",
			modelId: "some-model",
			reasoningEffort: "high",
		});
		const output = write.mock.calls.map((call) => String(call[0])).join("");
		expect(output).toContain("some-model");
		expect(output).toContain("high");
		expect(output).toContain("anthropic");
	});

	it("warns when gemini receives a reasoning effort setting", () => {
		const write = captureStderr();
		warnOnAgentSettingsMechanismGaps("gemini", { reasoningEffort: "high" });
		const output = write.mock.calls.map((call) => String(call[0])).join("");
		expect(output).toContain("high");
		expect(output).toContain("Gemini CLI");
	});

	it("does not warn for gemini model settings", () => {
		const write = captureStderr();
		warnOnAgentSettingsMechanismGaps("gemini", { modelId: "gemini-2.5-pro" });
		expect(write).not.toHaveBeenCalled();
	});

	it("warns when a provider is set for an agent that never reads it", () => {
		const write = captureStderr();
		warnOnAgentSettingsMechanismGaps("claude", { providerId: "anthropic" });
		const output = write.mock.calls.map((call) => String(call[0])).join("");
		expect(output).toContain("anthropic");
		expect(output).toContain("provider");
	});

	it("does not warn for provider on agents that read one (cline/opencode)", () => {
		const write = captureStderr();
		warnOnAgentSettingsMechanismGaps("cline", { providerId: "anthropic" });
		warnOnAgentSettingsMechanismGaps("opencode", { providerId: "openrouter" });
		expect(write).not.toHaveBeenCalled();
	});
});

describe("resolveSettingsFlag", () => {
	it("returns the generic flag when only it is set", () => {
		expect(resolveSettingsFlag("generic", undefined, "--model", "--cline-model")).toBe("generic");
	});

	it("returns the deprecated alias when only it is set", () => {
		expect(resolveSettingsFlag(undefined, "alias", "--model", "--cline-model")).toBe("alias");
	});

	it("throws when both forms are passed for the same field", () => {
		expect(() => resolveSettingsFlag("generic", "alias", "--model", "--cline-model")).toThrow(
			"Cannot use both --model and the deprecated --cline-model",
		);
	});
});

describe("formatTaskAgentSettings", () => {
	it("emits agentSettings plus a deprecated clineSettings mirror", () => {
		expect(formatTaskAgentSettings({ modelId: "acme-model" })).toEqual({
			agentSettings: { modelId: "acme-model" },
			clineSettings: { modelId: "acme-model" },
		});
	});

	it("emits an empty object when settings are absent", () => {
		expect(formatTaskAgentSettings(undefined)).toEqual({});
	});
});

describe("formatAgentIdOptionHelp", () => {
	it("lists every schema agent id including grok", () => {
		const createHelp = formatAgentIdOptionHelp("create");
		const updateHelp = formatAgentIdOptionHelp("update");
		expect(createHelp).toContain("grok");
		expect(updateHelp).toContain("grok");
		for (const agentId of runtimeAgentIdSchema.options) {
			expect(createHelp).toContain(agentId);
			expect(updateHelp).toContain(agentId);
		}
		expect(createHelp).toBe(`Agent override: ${runtimeAgentIdSchema.options.join(" | ")} | default.`);
		expect(updateHelp).toBe(`Agent override: ${runtimeAgentIdSchema.options.join(" | ")}. Use "default" to clear.`);
	});
});

describe("registerTaskCommand agent-id help", () => {
	function getAgentIdOptionDescription(commandName: "create" | "update"): string | undefined {
		const program = new Command();
		registerTaskCommand(program);
		const task = program.commands.find((command) => command.name() === "task");
		const subcommand = task?.commands.find((command) => command.name() === commandName);
		return subcommand?.options.find((option) => option.long === "--agent-id")?.description;
	}

	it("includes grok on task create and task update", () => {
		const createHelp = getAgentIdOptionDescription("create");
		const updateHelp = getAgentIdOptionDescription("update");
		expect(createHelp).toBe(formatAgentIdOptionHelp("create"));
		expect(updateHelp).toBe(formatAgentIdOptionHelp("update"));
		expect(createHelp).toContain("grok");
		expect(updateHelp).toContain("grok");
	});
});

function createBoard(): RuntimeBoardData {
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [] },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "trash", title: "Done", cards: [] },
		],
		dependencies: [],
	};
}

function createLinkedBacklogCard() {
	const createA = addTaskToColumn(createBoard(), "review", { prompt: "Task A", baseRef: "main" }, () => "aaaaa111");
	const createB = addTaskToColumn(createA.board, "review", { prompt: "Task B", baseRef: "main" }, () => "bbbbb111");
	const createC = addTaskToColumn(createB.board, "backlog", { prompt: "Task C", baseRef: "main" }, () => "ccccc111");
	return createC.board;
}

describe("parseTaskIdList", () => {
	it("splits comma-separated IDs and trims whitespace", () => {
		expect(parseTaskIdList("aaaaa, bbbbb")).toEqual(["aaaaa", "bbbbb"]);
	});

	it("dedupes IDs in a single flag value", () => {
		expect(parseTaskIdList("aaaaa,aaaaa,bbbbb")).toEqual(["aaaaa", "bbbbb"]);
	});

	it("rejects an empty flag value", () => {
		expect(() => parseTaskIdList(" , ")).toThrow('Invalid --blocked-by value " , ". Expected one or more task IDs.');
	});
});

describe("resolveTaskLinkBlockerIds", () => {
	it("keeps --linked-task-id as the single-blocker form", () => {
		expect(resolveTaskLinkBlockerIds({ linkedTaskId: "aaaaa" })).toEqual(["aaaaa"]);
	});

	it("accepts comma-separated --blocked-by IDs", () => {
		expect(resolveTaskLinkBlockerIds({ blockedBy: "aaaaa,bbbbb" })).toEqual(["aaaaa", "bbbbb"]);
	});

	it("accepts repeated --blocked-by values", () => {
		expect(resolveTaskLinkBlockerIds({ blockedBy: ["aaaaa", "bbbbb"] })).toEqual(["aaaaa", "bbbbb"]);
	});

	it("accepts mixed --blocked-by and --linked-task-id without duplicating", () => {
		expect(
			resolveTaskLinkBlockerIds({
				blockedBy: ["aaaaa,bbbbb"],
				linkedTaskId: "aaaaa",
			}),
		).toEqual(["aaaaa", "bbbbb"]);
	});

	it("requires at least one blocker flag", () => {
		expect(() => resolveTaskLinkBlockerIds({})).toThrow("task link requires --linked-task-id or --blocked-by.");
		expect(() => resolveTaskLinkBlockerIds({ blockedBy: [] })).toThrow(
			"task link requires --linked-task-id or --blocked-by.",
		);
	});

	it("rejects a blank --linked-task-id", () => {
		expect(() => resolveTaskLinkBlockerIds({ linkedTaskId: "  " })).toThrow(
			'Invalid --linked-task-id value "  ". Expected a task ID.',
		);
	});
});

describe("AND task link CLI helpers", () => {
	it("links two blockers and does not ready C until both review prerequisites are done", () => {
		const board = createLinkedBacklogCard();
		const blockerIds = resolveTaskLinkBlockerIds({ blockedBy: "aaaaa,bbbbb" });
		const linked = addTaskDependencies(board, "ccccc", blockerIds);

		expect(linked.dependencies).toHaveLength(2);
		expect(linked.dependencies.map((dependency) => dependency.toTaskId)).toEqual(["aaaaa", "bbbbb"]);
		expect(getUnfinishedPrerequisiteTaskIds(linked.board, "ccccc")).toEqual(["aaaaa", "bbbbb"]);

		const trashA = trashTaskAndGetReadyLinkedTaskIds(linked.board, "aaaaa");
		expect(trashA.readyTaskIds).toEqual([]);
		expect(getUnfinishedPrerequisiteTaskIds(trashA.board, "ccccc")).toEqual(["bbbbb"]);

		const trashB = trashTaskAndGetReadyLinkedTaskIds(trashA.board, "bbbbb");
		expect(trashB.readyTaskIds).toEqual(["ccccc"]);
		expect(getUnfinishedPrerequisiteTaskIds(trashB.board, "ccccc")).toEqual([]);
	});

	it("still links a single --linked-task-id blocker", () => {
		const board = createLinkedBacklogCard();
		const blockerIds = resolveTaskLinkBlockerIds({ linkedTaskId: "aaaaa" });
		const linked = addTaskDependencies(board, "ccccc", blockerIds);

		expect(linked.dependencies).toHaveLength(1);
		expect(linked.dependencies[0]?.toTaskId).toBe("aaaaa");
		expect(getUnfinishedPrerequisiteTaskIds(linked.board, "ccccc")).toEqual(["aaaaa"]);

		const trashA = trashTaskAndGetReadyLinkedTaskIds(linked.board, "aaaaa");
		expect(trashA.readyTaskIds).toEqual(["ccccc"]);
	});

	it("rejects invalid blocker IDs without returning a board", () => {
		const board = createLinkedBacklogCard();
		const blockerIds = resolveTaskLinkBlockerIds({ blockedBy: "aaaaa,nope" });
		expect(() => addTaskDependencies(board, "ccccc", blockerIds)).toThrow("One or more tasks could not be found.");
		expect(board.dependencies).toEqual([]);
	});

	it("rejects linking a task to itself", () => {
		const board = createLinkedBacklogCard();
		expect(() => addTaskDependencies(board, "ccccc", ["ccccc"])).toThrow("A task cannot be linked to itself.");
	});

	it("rejects a blocker that is already done", () => {
		const board = createLinkedBacklogCard();
		const trashedA = moveTaskToColumn(board, "aaaaa", "trash");
		expect(() => addTaskDependencies(trashedA.board, "ccccc", ["aaaaa"])).toThrow("Links cannot include done tasks.");
	});
});
