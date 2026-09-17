import { describe, expect, it } from "vitest";

import {
	formatMachineDefaultHint,
	indexAgentMachineDefaults,
	probeAgentMachineDefaults,
	resolveDisplayedAgentModelAndEffort,
	UNKNOWN_AGENT_MACHINE_DEFAULTS,
} from "../../../src/core/agent-machine-defaults";

const CLAUDE_SETTINGS = `{
  "model": "claude-fable-5-1[1m]",
  "effortLevel": "xhigh",
  "modelSettings": {
    "claude-fable-5-1": { "effortLevel": "low" }
  }
}`;

const CLAUDE_JSON_FALLBACK = `{
  "numStartups": 3,
  "model": "claude-opus-5",
  "effortLevel": "high",
  "projects": { "/tmp/example": { "model": "claude-haiku-4-5-20251001" } }
}`;

const CODEX_TOML = `
model = "gpt-6-astra"
model_reasoning_effort = "low"
tool_output_token_limit = 25000

notify = ["/tmp/notify", "turn-ended"]

[projects."/Users/example/repo"]
trust_level = "trusted"
`;

const GROK_TOML = `
[cli]
installer = "internal"

[ui]
fork_secondary_model = "grok-4.6"

[models]
default = "grok-4.6"
default_reasoning_effort = "xhigh"
`;

const CLINE_PROVIDERS = `{
  "version": 1,
  "lastUsedProvider": "gemini",
  "providers": {
    "gemini": {
      "settings": {
        "provider": "gemini",
        "model": "gemini-2.5-flash-preview-05-20",
        "reasoning": { "effort": "medium" }
      }
    }
  }
}`;

describe("probeAgentMachineDefaults", () => {
	it("reads Claude model and effortLevel from settings.json, ignoring per-model overrides", () => {
		expect(
			probeAgentMachineDefaults("claude", {
				files: { claudeSettings: CLAUDE_SETTINGS },
			}),
		).toEqual({
			modelId: "claude-fable-5-1[1m]",
			reasoningEffort: "xhigh",
			source: "claude-settings",
		});
	});

	it("falls back to top-level ~/.claude.json when settings.json is missing", () => {
		expect(
			probeAgentMachineDefaults("claude", {
				files: { claudeJson: CLAUDE_JSON_FALLBACK },
			}),
		).toEqual({
			modelId: "claude-opus-5",
			reasoningEffort: "high",
			source: "claude-settings",
		});
	});

	it("fills missing settings.json fields from ~/.claude.json without using nested project models", () => {
		expect(
			probeAgentMachineDefaults("claude", {
				files: {
					claudeSettings: `{ "model": "claude-sonnet-5" }`,
					claudeJson: CLAUDE_JSON_FALLBACK,
				},
			}),
		).toEqual({
			modelId: "claude-sonnet-5",
			reasoningEffort: "high",
			source: "claude-settings",
		});
	});

	it("reads Codex top-level model and model_reasoning_effort, not project tables", () => {
		expect(
			probeAgentMachineDefaults("codex", {
				files: { codexConfig: CODEX_TOML },
			}),
		).toEqual({
			modelId: "gpt-6-astra",
			reasoningEffort: "low",
			source: "codex-config",
		});
	});

	it("reads Grok [models] default and default_reasoning_effort, not ui.fork_secondary_model", () => {
		expect(
			probeAgentMachineDefaults("grok", {
				files: { grokConfig: GROK_TOML },
			}),
		).toEqual({
			modelId: "grok-4.6",
			reasoningEffort: "xhigh",
			source: "grok-config",
		});
	});

	it("uses injected Cline SDK settings instead of inventing a second default", () => {
		expect(
			probeAgentMachineDefaults("cline", {
				files: { clineProviders: CLINE_PROVIDERS },
				clineProviderSettings: {
					modelId: "anthropic/claude-sonnet-4-6",
					reasoningEffort: "high",
				},
			}),
		).toEqual({
			modelId: "anthropic/claude-sonnet-4-6",
			reasoningEffort: "high",
			source: "cline-sdk",
		});
	});

	it("parses Cline providers.json when SDK settings are not injected", () => {
		expect(
			probeAgentMachineDefaults("cline", {
				files: { clineProviders: CLINE_PROVIDERS },
			}),
		).toEqual({
			modelId: "gemini-2.5-flash-preview-05-20",
			reasoningEffort: "medium",
			source: "cline-sdk",
		});
	});

	it("best-effort parses Gemini/OpenCode/Droid JSON and reports source unknown", () => {
		expect(
			probeAgentMachineDefaults("gemini", {
				files: { geminiSettings: `{ "model": "gemini-2.5-pro" }` },
			}),
		).toEqual({
			modelId: "gemini-2.5-pro",
			reasoningEffort: null,
			source: "unknown",
		});
		expect(
			probeAgentMachineDefaults("opencode", {
				files: { opencodeConfig: `{ "model": "anthropic/claude-sonnet-4-5" }` },
			}),
		).toEqual({
			modelId: "anthropic/claude-sonnet-4-5",
			reasoningEffort: null,
			source: "unknown",
		});
		expect(
			probeAgentMachineDefaults("opencode", {
				files: {
					opencodeModelState: JSON.stringify({
						recent: [{ providerID: "openrouter", modelID: "acme-model" }],
					}),
				},
			}),
		).toEqual({
			modelId: "openrouter/acme-model",
			reasoningEffort: null,
			source: "unknown",
		});
		expect(
			probeAgentMachineDefaults("droid", {
				files: { droidSettings: `{ "model": "factory-standard" }` },
			}),
		).toEqual({
			modelId: "factory-standard",
			reasoningEffort: null,
			source: "unknown",
		});
	});

	it("returns unknown when config files are missing or invalid, without throwing", () => {
		expect(probeAgentMachineDefaults("claude", { files: {} })).toEqual(UNKNOWN_AGENT_MACHINE_DEFAULTS);
		expect(probeAgentMachineDefaults("codex", { files: { codexConfig: null } })).toEqual(
			UNKNOWN_AGENT_MACHINE_DEFAULTS,
		);
		expect(probeAgentMachineDefaults("grok", { files: { grokConfig: "not = toml [" } })).toEqual({
			modelId: null,
			reasoningEffort: null,
			source: "grok-config",
		});
		expect(probeAgentMachineDefaults("kiro", { files: {} })).toEqual(UNKNOWN_AGENT_MACHINE_DEFAULTS);
		expect(probeAgentMachineDefaults("claude", { files: { claudeSettings: "{not json" } })).toEqual(
			UNKNOWN_AGENT_MACHINE_DEFAULTS,
		);
	});
});

describe("machine default display helpers", () => {
	it("formats inherited model and effort with a machine-default hint", () => {
		expect(
			formatMachineDefaultHint({
				modelId: "claude-opus-5",
				reasoningEffort: "xhigh",
				source: "claude-settings",
			}),
		).toBe("claude-opus-5 · xhigh (machine default)");
		expect(
			formatMachineDefaultHint({
				modelId: "gpt-6-astra",
				reasoningEffort: null,
				source: "codex-config",
			}),
		).toBe("gpt-6-astra (machine default)");
		expect(formatMachineDefaultHint(UNKNOWN_AGENT_MACHINE_DEFAULTS)).toBeNull();
	});

	it("prefers pinned card values over machine defaults", () => {
		expect(
			resolveDisplayedAgentModelAndEffort({
				agentSettings: { modelId: "cheap-model", reasoningEffort: "low" },
				machineDefaults: {
					modelId: "claude-opus-5",
					reasoningEffort: "xhigh",
					source: "claude-settings",
				},
			}),
		).toEqual({
			modelId: "cheap-model",
			reasoningEffort: "low",
			modelInherited: false,
			effortInherited: false,
		});
		expect(
			resolveDisplayedAgentModelAndEffort({
				machineDefaults: {
					modelId: "claude-opus-5",
					reasoningEffort: "xhigh",
					source: "claude-settings",
				},
			}),
		).toEqual({
			modelId: "claude-opus-5",
			reasoningEffort: "xhigh",
			modelInherited: true,
			effortInherited: true,
		});
	});

	it("indexes machine defaults by agent id", () => {
		expect(
			indexAgentMachineDefaults([
				{
					id: "claude",
					machineDefaults: {
						modelId: "claude-opus-5",
						reasoningEffort: "xhigh",
						source: "claude-settings",
					},
				},
				{ id: "kiro" },
			]),
		).toEqual({
			claude: {
				modelId: "claude-opus-5",
				reasoningEffort: "xhigh",
				source: "claude-settings",
			},
		});
	});
});
