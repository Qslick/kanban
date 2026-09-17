import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const commandDiscoveryMocks = vi.hoisted(() => ({
	isBinaryAvailableOnPath: vi.fn(),
}));

vi.mock("../../../src/terminal/command-discovery.js", () => ({
	isBinaryAvailableOnPath: commandDiscoveryMocks.isBinaryAvailableOnPath,
}));

import type { RuntimeConfigState } from "../../../src/config/runtime-config";
import { UNKNOWN_AGENT_MACHINE_DEFAULTS } from "../../../src/core/agent-machine-defaults";
import {
	buildAgentCapabilityReport,
	buildRuntimeConfigResponse,
	detectInstalledCommands,
	resolveAgentCommand,
} from "../../../src/terminal/agent-registry";
import { createTempDir } from "../../utilities/temp-dir";

const EMPTY_MACHINE_DEFAULT_FILES = { files: {} } as const;

function createRuntimeConfigState(overrides: Partial<RuntimeConfigState> = {}): RuntimeConfigState {
	return {
		globalConfigPath: "/tmp/global-config.json",
		projectConfigPath: "/tmp/project-config.json",
		selectedAgentId: "claude",
		selectedShortcutLabel: null,
		agentAutonomousModeEnabled: true,
		readyForReviewNotificationsEnabled: true,
		maxInProgressTasks: 3,
		panelReviewEnabled: false,
		panelReviewFamilies: ["grok", "claude", "gpt", "gemini"],
		shortcuts: [],
		commitPromptTemplate: "commit",
		openPrPromptTemplate: "pr",
		commitPromptTemplateDefault: "commit",
		openPrPromptTemplateDefault: "pr",
		...overrides,
	};
}

beforeEach(() => {
	commandDiscoveryMocks.isBinaryAvailableOnPath.mockReset();
	commandDiscoveryMocks.isBinaryAvailableOnPath.mockReturnValue(false);
	delete process.env.KANBAN_DEBUG_MODE;
	delete process.env.DEBUG_MODE;
	delete process.env.debug_mode;
});

describe("agent-registry", () => {
	it("detects installed commands from the inherited PATH", () => {
		commandDiscoveryMocks.isBinaryAvailableOnPath.mockImplementation((binary: string) => binary === "claude");

		const detected = detectInstalledCommands();

		expect(detected).toEqual(["claude"]);
		expect(commandDiscoveryMocks.isBinaryAvailableOnPath).toHaveBeenCalledTimes(9);
	});

	it("treats shell-only agents as unavailable", () => {
		commandDiscoveryMocks.isBinaryAvailableOnPath.mockImplementation((binary: string) => binary === "npx");

		const resolved = resolveAgentCommand(createRuntimeConfigState({ selectedAgentId: "claude" }));

		expect(resolved).toBeNull();
	});
});

describe("buildRuntimeConfigResponse", () => {
	it("keeps curated agent default args independent of autonomous mode", () => {
		const config = createRuntimeConfigState({
			agentAutonomousModeEnabled: true,
		});

		const response = buildRuntimeConfigResponse(
			config,
			{
				providerId: null,
				modelId: null,
				baseUrl: null,
				apiKeyConfigured: false,
				oauthProvider: null,
				oauthAccessTokenConfigured: false,
				oauthRefreshTokenConfigured: false,
				oauthAccountId: null,
				oauthExpiresAt: null,
			},
			EMPTY_MACHINE_DEFAULT_FILES,
		);

		expect(response.agentAutonomousModeEnabled).toBe(true);
		expect(response.maxInProgressTasks).toBe(3);
		expect(response.agents.map((agent) => agent.id)).toEqual(["claude", "codex", "cline", "droid", "kiro", "grok"]);
		expect(response.agents.find((agent) => agent.id === "claude")?.defaultArgs).toEqual([]);
		expect(response.agents.find((agent) => agent.id === "codex")?.defaultArgs).toEqual([]);
		expect(response.agents.find((agent) => agent.id === "cline")?.defaultArgs).toEqual([]);
		expect(response.agents.find((agent) => agent.id === "droid")?.defaultArgs).toEqual([]);
		expect(response.agents.find((agent) => agent.id === "kiro")?.defaultArgs).toEqual(["chat"]);
		expect(response.agents.find((agent) => agent.id === "grok")?.defaultArgs).toEqual([]);
		expect(response.agents.find((agent) => agent.id === "cline")?.installed).toBe(true);
	});

	it("omits autonomous flags from curated agent commands when disabled", () => {
		const config = createRuntimeConfigState({
			agentAutonomousModeEnabled: false,
		});
		commandDiscoveryMocks.isBinaryAvailableOnPath.mockImplementation((binary: string) => binary === "claude");

		const response = buildRuntimeConfigResponse(
			config,
			{
				providerId: null,
				modelId: null,
				baseUrl: null,
				apiKeyConfigured: false,
				oauthProvider: null,
				oauthAccessTokenConfigured: false,
				oauthRefreshTokenConfigured: false,
				oauthAccountId: null,
				oauthExpiresAt: null,
			},
			EMPTY_MACHINE_DEFAULT_FILES,
		);

		expect(response.agentAutonomousModeEnabled).toBe(false);
		expect(response.agents.map((agent) => agent.id)).toEqual(["claude", "codex", "cline", "droid", "kiro", "grok"]);
		expect(response.agents.find((agent) => agent.id === "claude")?.defaultArgs).toEqual([]);
		expect(response.agents.find((agent) => agent.id === "codex")?.defaultArgs).toEqual([]);
		expect(response.agents.find((agent) => agent.id === "cline")?.defaultArgs).toEqual([]);
		expect(response.agents.find((agent) => agent.id === "droid")?.defaultArgs).toEqual([]);
		expect(response.agents.find((agent) => agent.id === "kiro")?.defaultArgs).toEqual(["chat"]);
		expect(response.agents.find((agent) => agent.id === "grok")?.defaultArgs).toEqual([]);
		expect(response.agents.find((agent) => agent.id === "cline")?.installed).toBe(true);
		expect(response.agents.find((agent) => agent.id === "claude")?.command).toBe("claude");
		expect(response.agents.find((agent) => agent.id === "codex")?.command).toBe("codex");
		expect(response.agents.find((agent) => agent.id === "droid")?.command).toBe("droid");
		expect(response.agents.find((agent) => agent.id === "kiro")?.command).toBe("kiro-cli chat");
		expect(response.agents.find((agent) => agent.id === "grok")?.command).toBe("grok");
	});

	it("sets debug mode from runtime environment variables", () => {
		process.env.KANBAN_DEBUG_MODE = "true";
		const response = buildRuntimeConfigResponse(
			createRuntimeConfigState(),
			{
				providerId: null,
				modelId: null,
				baseUrl: null,
				apiKeyConfigured: false,
				oauthProvider: null,
				oauthAccessTokenConfigured: false,
				oauthRefreshTokenConfigured: false,
				oauthAccountId: null,
				oauthExpiresAt: null,
			},
			EMPTY_MACHINE_DEFAULT_FILES,
		);
		expect(response.debugModeEnabled).toBe(true);
	});

	it("supports debug_mode fallback env name", () => {
		process.env.debug_mode = "1";
		const response = buildRuntimeConfigResponse(
			createRuntimeConfigState(),
			{
				providerId: null,
				modelId: null,
				baseUrl: null,
				apiKeyConfigured: false,
				oauthProvider: null,
				oauthAccessTokenConfigured: false,
				oauthRefreshTokenConfigured: false,
				oauthAccountId: null,
				oauthExpiresAt: null,
			},
			EMPTY_MACHINE_DEFAULT_FILES,
		);
		expect(response.debugModeEnabled).toBe(true);
	});

	it("includes probed machine defaults on curated agents without hitting the real home directory", () => {
		const response = buildRuntimeConfigResponse(
			createRuntimeConfigState(),
			{
				providerId: "cline",
				modelId: "anthropic/claude-sonnet-4-6",
				baseUrl: null,
				reasoningEffort: "high",
				apiKeyConfigured: false,
				oauthProvider: null,
				oauthAccessTokenConfigured: false,
				oauthRefreshTokenConfigured: false,
				oauthAccountId: null,
				oauthExpiresAt: null,
			},
			{
				files: {
					claudeSettings: `{ "model": "claude-fable-5-1[1m]", "effortLevel": "xhigh" }`,
				},
			},
		);
		expect(response.agents.find((agent) => agent.id === "claude")?.machineDefaults).toEqual({
			modelId: "claude-fable-5-1[1m]",
			reasoningEffort: "xhigh",
			source: "claude-settings",
		});
		expect(response.agents.find((agent) => agent.id === "cline")?.machineDefaults).toEqual({
			modelId: "anthropic/claude-sonnet-4-6",
			reasoningEffort: "high",
			source: "cline-sdk",
		});
		expect(response.agents.find((agent) => agent.id === "kiro")?.machineDefaults).toEqual(
			UNKNOWN_AGENT_MACHINE_DEFAULTS,
		);
	});
});

describe("buildAgentCapabilityReport", () => {
	it("reports mechanism-only capabilities with no value lists", () => {
		commandDiscoveryMocks.isBinaryAvailableOnPath.mockReturnValue(false);

		const report = buildAgentCapabilityReport(createRuntimeConfigState(), EMPTY_MACHINE_DEFAULT_FILES);

		expect(report.length).toBeGreaterThan(0);
		for (const entry of report) {
			expect(typeof entry.id).toBe("string");
			expect(typeof entry.label).toBe("string");
			expect(typeof entry.installed).toBe("boolean");
			expect(typeof entry.configured).toBe("boolean");
			expect(typeof entry.launchSupported).toBe("boolean");
			expect(["flag", "config", "sdk", "none"]).toContain(entry.capabilities.modelOverride);
			expect(["flag", "config", "sdk", "none"]).toContain(entry.capabilities.effortOverride);
			expect(["flag", "config", "sdk", "none"]).toContain(entry.capabilities.providerOverride);
			expect(entry.capabilities.docsUrl).toMatch(/^https?:\/\//);
			expect(entry.machineDefaults).toEqual(UNKNOWN_AGENT_MACHINE_DEFAULTS);
		}
	});

	it("marks the embedded Cline runtime as installed regardless of binary detection", () => {
		commandDiscoveryMocks.isBinaryAvailableOnPath.mockReturnValue(false);

		const report = buildAgentCapabilityReport(createRuntimeConfigState(), EMPTY_MACHINE_DEFAULT_FILES);

		expect(report.find((entry) => entry.id === "cline")?.installed).toBe(true);
		expect(report.find((entry) => entry.id === "cline")?.launchSupported).toBe(true);
	});

	it("probes machine defaults from an injected home directory, not the developer home", () => {
		const home = createTempDir("kanban-machine-defaults-");
		try {
			mkdirSync(join(home.path, ".claude"));
			mkdirSync(join(home.path, ".codex"));
			mkdirSync(join(home.path, ".grok"));
			writeFileSync(
				join(home.path, ".claude", "settings.json"),
				JSON.stringify({ model: "claude-test-model", effortLevel: "low" }),
			);
			writeFileSync(
				join(home.path, ".codex", "config.toml"),
				'model = "codex-test-model"\nmodel_reasoning_effort = "medium"\n',
			);
			writeFileSync(
				join(home.path, ".grok", "config.toml"),
				'[models]\ndefault = "grok-test-model"\ndefault_reasoning_effort = "high"\n',
			);

			const report = buildAgentCapabilityReport(createRuntimeConfigState(), { homeDir: home.path });

			expect(report.find((entry) => entry.id === "claude")?.machineDefaults).toEqual({
				modelId: "claude-test-model",
				reasoningEffort: "low",
				source: "claude-settings",
			});
			expect(report.find((entry) => entry.id === "codex")?.machineDefaults).toEqual({
				modelId: "codex-test-model",
				reasoningEffort: "medium",
				source: "codex-config",
			});
			expect(report.find((entry) => entry.id === "grok")?.machineDefaults).toEqual({
				modelId: "grok-test-model",
				reasoningEffort: "high",
				source: "grok-config",
			});
			expect(report.find((entry) => entry.id === "gemini")?.machineDefaults).toEqual(UNKNOWN_AGENT_MACHINE_DEFAULTS);
		} finally {
			home.cleanup();
		}
	});
});
