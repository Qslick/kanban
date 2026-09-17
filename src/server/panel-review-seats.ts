import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir as osHomedir, tmpdir as osTmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";

import type { PanelReviewFamily, PanelReviewVerdict, PanelReviewVerdictKind } from "../core/panel-review";
import { PANEL_REVIEW_VERDICT_KINDS } from "../core/panel-review";
import { isBinaryAvailableOnPath } from "../terminal/command-discovery";
import type { DispatchPanelSeats, PanelReviewPacket } from "./panel-review-runner";
import { PROCESS_SIGKILL_ESCALATION_MS, terminateProcessForTimeout } from "./process-termination";

/** Wall-clock bound per seat. Seats run in parallel, so panel wall time ≈ slowest seat. */
export const PANEL_REVIEW_SEAT_TIMEOUT_MS = 90_000;

const PANEL_REVIEW_OUTPUT_LIMIT_CHARS = 1_048_576;
const PANEL_REVIEW_NOTE_MAX_CHARS = 240;
const PANEL_REVIEW_FORBIDDEN_FLAGS = ["--always-approve", "--yolo", "--dangerously-skip-permissions"] as const;
const DEFAULT_GROK_MODEL = "grok-4.6";
const DEFAULT_GROK_EFFORT = "high";
const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash-high";
const VERDICT_KIND_SET = new Set<string>(PANEL_REVIEW_VERDICT_KINDS);
const USAGE_LIMIT_RE =
	/usage limit|limit reached|hit your limit|quota|rate.?limit|too many requests|resource.?exhausted|insufficient (credits|balance|quota)|out of credits|credit balance/i;
const PERMISSION_DENY_RE = /no output produced|auto-denied/i;

export interface PanelSeatProcessResult {
	stdout: string;
	stderr: string;
	exitCode: number | null;
	timedOut?: boolean;
}

export interface PanelSeatInvocation {
	family: PanelReviewFamily;
	command: string;
	args: string[];
	env: NodeJS.ProcessEnv;
	cwd: string;
	stdin: string | null;
	outputPath: string | null;
}

export type SpawnPanelSeat = (invocation: PanelSeatInvocation) => Promise<PanelSeatProcessResult>;

export interface PanelReviewRosterModels {
	grokModel: string;
	geminiModel: string;
}

export interface CreateLivePanelSeatDispatcherDependencies {
	isBinaryAvailable?: (binary: string) => boolean;
	spawnSeat?: SpawnPanelSeat;
	homedir?: () => string;
	tmpdir?: () => string;
	readRoster?: () => Promise<PanelReviewRosterModels | null>;
	listAgyModels?: (agyBinary: string) => Promise<string[]>;
	grokModel?: string;
	geminiModel?: string;
	timeoutMs?: number;
}

export function isPanelSeatUsageLimitError(text: string, packetText = ""): boolean {
	const lines = text.split(/\r?\n/).slice(-20);
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || !USAGE_LIMIT_RE.test(trimmed)) {
			continue;
		}
		if (packetText.length > 0 && packetText.includes(trimmed)) {
			continue;
		}
		return true;
	}
	return false;
}

export function isPanelSeatPermissionDenied(stderr: string, stdout: string): boolean {
	if (stdout.trim().length > 0) {
		return false;
	}
	return PERMISSION_DENY_RE.test(stderr);
}

export function extractGrokSeatText(ndjson: string): string {
	let extracted = "";
	for (const line of ndjson.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		try {
			const parsed = JSON.parse(trimmed) as { type?: unknown; result?: unknown };
			if (parsed.type === "result" && typeof parsed.result === "string") {
				extracted = parsed.result;
			}
		} catch {
			// Non-JSON stream noise is ignored; the result line is the payload.
		}
	}
	return extracted;
}

export function parsePanelSeatReply(text: string): { kind: PanelReviewVerdictKind; note?: string } | null {
	const lines = text.split(/\r?\n/);
	let verdictIndex = -1;
	let kind: PanelReviewVerdictKind | "unrecognized" | null = null;
	let unrecognized = "";
	for (let index = 0; index < lines.length; index += 1) {
		const stripped = stripLeadingMarkup(lines[index] ?? "");
		const match = /^VERDICT:\s*(.+)$/i.exec(stripped);
		if (!match) {
			continue;
		}
		verdictIndex = index;
		const token = (match[1] ?? "")
			.trim()
			.split(/\s+/)[0]
			?.replace(/[^A-Za-z_]/g, "")
			.toUpperCase();
		if (token && VERDICT_KIND_SET.has(token)) {
			kind = token as PanelReviewVerdictKind;
		} else {
			kind = "unrecognized";
			unrecognized = (match[1] ?? "").trim();
		}
		break;
	}
	if (kind === null) {
		return null;
	}
	if (kind === "unrecognized") {
		return {
			kind: "UNAVAILABLE",
			note: truncatePanelSeatNote(`Unrecognized verdict "${unrecognized}".`),
		};
	}
	const note = extractTopRiskNote(lines, verdictIndex);
	return note ? { kind, note } : { kind };
}

export function pickAgyGeminiModel(models: readonly string[]): string | null {
	const scored = models
		.map((id) => scoreGeminiModel(id))
		.filter((entry): entry is ScoredGeminiModel => entry !== null)
		.sort(compareGeminiModels);
	return scored[0]?.id ?? null;
}

export function buildPanelSeatInvocation(input: {
	family: PanelReviewFamily;
	binary: string;
	packet: PanelReviewPacket;
	packetPath: string;
	outputPath: string;
	grokModel: string;
	geminiModel: string;
	timeoutMs: number;
}): PanelSeatInvocation {
	const worktreePath = input.packet.worktreePath;
	const packetPath = resolvePath(input.packetPath);
	switch (input.family) {
		case "gpt":
			return assertSafeInvocation({
				family: input.family,
				command: input.binary,
				args: [
					"exec",
					"-s",
					"read-only",
					"--skip-git-repo-check",
					"--ephemeral",
					"-C",
					worktreePath,
					"-o",
					input.outputPath,
					"-",
				],
				env: {},
				cwd: worktreePath,
				stdin: input.packet.markdown,
				outputPath: input.outputPath,
			});
		case "gemini":
			return assertSafeInvocation({
				family: input.family,
				command: input.binary,
				args: [
					"-p",
					input.packet.markdown,
					"--model",
					input.geminiModel,
					"--disable-slash-commands",
					"--print-timeout",
					formatPrintTimeout(input.timeoutMs),
					"--add-dir",
					worktreePath,
				],
				env: {},
				cwd: worktreePath,
				stdin: null,
				outputPath: null,
			});
		case "grok":
			return assertSafeInvocation({
				family: input.family,
				command: input.binary,
				args: [
					"--prompt-file",
					packetPath,
					"--verbatim",
					"-m",
					input.grokModel,
					"--reasoning-effort",
					DEFAULT_GROK_EFFORT,
					"--cwd",
					worktreePath,
					"--output-format",
					"streaming-messages-json",
					"--tools",
					"read_file,grep,list_dir",
					"--disallowed-tools",
					"search_tool,use_tool,Agent",
					"--deny",
					"MCPTool",
					"--disable-web-search",
					"--no-subagents",
				],
				env: { GROK_MEMORY: "0" },
				cwd: worktreePath,
				stdin: null,
				outputPath: null,
			});
		case "claude":
			return assertSafeInvocation({
				family: input.family,
				command: input.binary,
				args: [
					"-p",
					"--output-format",
					"text",
					"--input-format",
					"text",
					"--tools",
					"Read,Grep,Glob",
					"--permission-prompts",
					"none",
					"--restricted",
					"--strict-mcp-config",
					"--no-session-persistence",
					"--disable-slash-commands",
					"--add-dir",
					worktreePath,
				],
				env: {},
				cwd: worktreePath,
				stdin: input.packet.markdown,
				outputPath: null,
			});
	}
}

export function createLivePanelSeatDispatcher(
	deps: CreateLivePanelSeatDispatcherDependencies = {},
): DispatchPanelSeats {
	const isBinaryAvailable = deps.isBinaryAvailable ?? isBinaryAvailableOnPath;
	const timeoutMs = deps.timeoutMs ?? PANEL_REVIEW_SEAT_TIMEOUT_MS;
	const spawnSeat =
		deps.spawnSeat ?? ((invocation) => defaultSpawnPanelSeat(invocation, timeoutMs, isBinaryAvailable));
	const resolveHome = deps.homedir ?? osHomedir;
	const resolveTmp = deps.tmpdir ?? osTmpdir;
	const benched = new Set<PanelReviewFamily>();
	let rosterPromise: Promise<PanelReviewRosterModels> | null = null;

	const resolveModels = async (agyBinary: string | null): Promise<PanelReviewRosterModels> => {
		if (deps.grokModel || deps.geminiModel) {
			return {
				grokModel: deps.grokModel ?? DEFAULT_GROK_MODEL,
				geminiModel: deps.geminiModel ?? DEFAULT_GEMINI_MODEL,
			};
		}
		if (!rosterPromise) {
			rosterPromise = (async () => {
				const roster = (await deps.readRoster?.()) ?? (await defaultReadRoster(resolveHome()));
				const grokModel = roster?.grokModel?.trim() || DEFAULT_GROK_MODEL;
				if (roster?.geminiModel?.trim()) {
					return { grokModel, geminiModel: roster.geminiModel.trim() };
				}
				if (agyBinary && deps.listAgyModels) {
					const listed = await deps.listAgyModels(agyBinary);
					return { grokModel, geminiModel: pickAgyGeminiModel(listed) ?? DEFAULT_GEMINI_MODEL };
				}
				if (agyBinary) {
					const listed = await defaultListAgyModels(agyBinary, isBinaryAvailable);
					return { grokModel, geminiModel: pickAgyGeminiModel(listed) ?? DEFAULT_GEMINI_MODEL };
				}
				return { grokModel, geminiModel: DEFAULT_GEMINI_MODEL };
			})();
		}
		return rosterPromise;
	};

	return async (packet, families) => {
		const binaries = new Map<PanelReviewFamily, string | null>();
		for (const family of families) {
			binaries.set(family, resolvePanelSeatBinary(family, isBinaryAvailable, resolveHome()));
		}
		const models = await resolveModels(binaries.get("gemini") ?? null);
		const tempDir = await createPanelReviewTempDir(resolveTmp(), packet.taskId);
		try {
			const packetPath = join(tempDir, "packet.md");
			await writeFile(packetPath, packet.markdown, { encoding: "utf8", mode: 0o600 });
			await chmod(packetPath, 0o600).catch(() => undefined);

			const runSeat = async (family: PanelReviewFamily): Promise<PanelReviewVerdict> => {
				try {
					if (benched.has(family)) {
						return { family, verdict: "BENCHED", note: "Provider is out of usage for this Kanban process." };
					}
					const binary = binaries.get(family) ?? null;
					if (!binary) {
						return { family, verdict: "UNAVAILABLE", note: missingBinaryNote(family) };
					}
					const outputPath = join(tempDir, `${family}.md`);
					const invocation = buildPanelSeatInvocation({
						family,
						binary,
						packet,
						packetPath,
						outputPath,
						grokModel: models.grokModel,
						geminiModel: models.geminiModel,
						timeoutMs,
					});
					return await runPanelSeatWithRetry({
						family,
						invocation,
						packetText: packet.markdown,
						spawnSeat,
						timeoutMs,
						readOutputFile: family === "gpt" ? () => readOptionalText(outputPath) : undefined,
						bench: () => {
							benched.add(family);
						},
					});
				} catch (error) {
					return {
						family,
						verdict: "UNAVAILABLE",
						note: truncatePanelSeatNote(error instanceof Error ? error.message : String(error)),
					};
				}
			};

			return await Promise.all(families.map((family) => runSeat(family)));
		} finally {
			await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
		}
	};
}

function missingBinaryNote(family: PanelReviewFamily): string {
	if (family === "grok") {
		return "grok binary not found on PATH or ~/.grok/bin/grok.";
	}
	if (family === "gemini") {
		return "agy binary not found on PATH or ~/.local/bin/agy.";
	}
	if (family === "gpt") {
		return "codex binary not found on PATH.";
	}
	return "claude binary not found on PATH.";
}

function resolvePanelSeatBinary(
	family: PanelReviewFamily,
	isBinaryAvailable: (binary: string) => boolean,
	homePath: string,
): string | null {
	if (family === "grok") {
		return firstAvailableBinary(["grok", join(homePath, ".grok", "bin", "grok")], isBinaryAvailable);
	}
	if (family === "gemini") {
		return firstAvailableBinary(["agy", join(homePath, ".local", "bin", "agy")], isBinaryAvailable);
	}
	if (family === "gpt") {
		return firstAvailableBinary(["codex"], isBinaryAvailable);
	}
	return firstAvailableBinary(["claude"], isBinaryAvailable);
}

function firstAvailableBinary(
	candidates: readonly string[],
	isBinaryAvailable: (binary: string) => boolean,
): string | null {
	for (const candidate of candidates) {
		if (isBinaryAvailable(candidate)) {
			return candidate;
		}
	}
	return null;
}

async function createPanelReviewTempDir(tmpRoot: string, taskId: string): Promise<string> {
	const root = join(tmpRoot, "kanban-panel");
	await mkdir(root, { recursive: true, mode: 0o700 });
	const dir = await mkdtemp(join(root, `${sanitizeTempSegment(taskId)}-`));
	await chmod(dir, 0o700).catch(() => undefined);
	return dir;
}

function sanitizeTempSegment(taskId: string): string {
	const safe = taskId.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80);
	return safe.length > 0 ? safe : "task";
}

async function defaultReadRoster(homePath: string): Promise<PanelReviewRosterModels | null> {
	const rosterPath = join(homePath, ".claude", "skills", "multi-model-panel", "roster.json");
	try {
		const raw = await readFile(rosterPath, "utf8");
		const parsed = JSON.parse(raw) as {
			grok?: { model?: unknown };
			gemini?: { model?: unknown };
		};
		const grokModel = typeof parsed.grok?.model === "string" ? parsed.grok.model.trim() : "";
		const geminiModel = typeof parsed.gemini?.model === "string" ? parsed.gemini.model.trim() : "";
		if (!grokModel && !geminiModel) {
			return null;
		}
		return {
			grokModel: grokModel || DEFAULT_GROK_MODEL,
			geminiModel: geminiModel || DEFAULT_GEMINI_MODEL,
		};
	} catch {
		return null;
	}
}

async function defaultListAgyModels(
	agyBinary: string,
	isBinaryAvailable: (binary: string) => boolean,
): Promise<string[]> {
	try {
		const result = await defaultSpawnPanelSeat(
			{
				family: "gemini",
				command: agyBinary,
				args: ["models"],
				env: {},
				cwd: osTmpdir(),
				stdin: null,
				outputPath: null,
			},
			5_000,
			isBinaryAvailable,
		);
		return `${result.stdout}\n${result.stderr}`.match(/gemini[-a-z0-9.]+/gi) ?? [];
	} catch {
		return [];
	}
}

async function runPanelSeatWithRetry(input: {
	family: PanelReviewFamily;
	invocation: PanelSeatInvocation;
	packetText: string;
	spawnSeat: SpawnPanelSeat;
	timeoutMs: number;
	readOutputFile?: () => Promise<string>;
	bench: () => void;
}): Promise<PanelReviewVerdict> {
	const first = await interpretSpawnAttempt(input);
	if (first.bench) {
		input.bench();
	}
	if (!first.retry) {
		return { family: input.family, verdict: first.kind, ...(first.note ? { note: first.note } : {}) };
	}
	const second = await interpretSpawnAttempt(input);
	if (second.bench) {
		input.bench();
	}
	return { family: input.family, verdict: second.kind, ...(second.note ? { note: second.note } : {}) };
}

async function interpretSpawnAttempt(input: {
	family: PanelReviewFamily;
	invocation: PanelSeatInvocation;
	packetText: string;
	spawnSeat: SpawnPanelSeat;
	timeoutMs: number;
	readOutputFile?: () => Promise<string>;
}): Promise<{ kind: PanelReviewVerdictKind; note?: string; retry: boolean; bench: boolean }> {
	let result: PanelSeatProcessResult;
	try {
		result = await input.spawnSeat(input.invocation);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (/\bENOENT\b/i.test(message)) {
			return {
				kind: "UNAVAILABLE",
				note: `Binary not found: ${input.invocation.command}`,
				retry: false,
				bench: false,
			};
		}
		return { kind: "UNAVAILABLE", note: truncatePanelSeatNote(message), retry: false, bench: false };
	}

	const combinedError = `${result.stderr}\n${result.stdout}`;
	if (isPanelSeatUsageLimitError(combinedError, input.packetText)) {
		return {
			kind: "BENCHED",
			note: truncatePanelSeatNote(firstMatchingUsageLine(combinedError, input.packetText) ?? "Out of usage."),
			retry: false,
			bench: true,
		};
	}

	let text = result.stdout;
	if (input.family === "gpt" && input.readOutputFile) {
		const fromFile = await input.readOutputFile();
		if (fromFile.trim().length > 0) {
			text = fromFile;
		}
	}
	if (input.family === "grok") {
		text = extractGrokSeatText(result.stdout);
	}

	if (isPanelSeatPermissionDenied(result.stderr, text)) {
		return {
			kind: "UNAVAILABLE",
			note: truncatePanelSeatNote(`permission auto-denied — ${tailText(result.stderr)}`),
			retry: false,
			bench: false,
		};
	}
	if (result.timedOut) {
		return {
			kind: "UNAVAILABLE",
			note: `timed out after ${Math.round(input.timeoutMs / 1000)}s`,
			retry: false,
			bench: false,
		};
	}

	const parsed = parsePanelSeatReply(text);
	if (parsed) {
		return { kind: parsed.kind, note: parsed.note, retry: false, bench: false };
	}
	return {
		kind: "UNAVAILABLE",
		note: truncatePanelSeatNote(tailText(result.stderr) || "empty or malformed reply"),
		retry: true,
		bench: false,
	};
}

function firstMatchingUsageLine(text: string, packetText: string): string | undefined {
	for (const line of text.split(/\r?\n/).slice(-20)) {
		const trimmed = line.trim();
		if (!trimmed || !USAGE_LIMIT_RE.test(trimmed)) {
			continue;
		}
		if (packetText.includes(trimmed)) {
			continue;
		}
		return trimmed;
	}
	return undefined;
}

function defaultSpawnPanelSeat(
	invocation: PanelSeatInvocation,
	timeoutMs: number,
	isBinaryAvailable: (binary: string) => boolean,
): Promise<PanelSeatProcessResult> {
	const wrapped = wrapWithPerlDeadline(invocation.command, invocation.args, timeoutMs, isBinaryAvailable);
	return new Promise((resolve, reject) => {
		const child = spawn(wrapped.command, wrapped.args, {
			cwd: invocation.cwd,
			env: { ...process.env, ...invocation.env },
			stdio: [invocation.stdin === null ? "ignore" : "pipe", "pipe", "pipe"],
			windowsHide: true,
		});

		let stdout = "";
		let stderr = "";
		let settled = false;
		let timedOut = false;

		const append = (current: string, chunk: Buffer | string): string => {
			const next = current + String(chunk);
			if (next.length <= PANEL_REVIEW_OUTPUT_LIMIT_CHARS) {
				return next;
			}
			return next.slice(0, PANEL_REVIEW_OUTPUT_LIMIT_CHARS);
		};

		const finish = (result: PanelSeatProcessResult) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeout);
			clearTimeout(failsafe);
			resolve(result);
		};

		child.stdout?.on("data", (chunk: Buffer | string) => {
			stdout = append(stdout, chunk);
		});
		child.stderr?.on("data", (chunk: Buffer | string) => {
			stderr = append(stderr, chunk);
		});
		if (invocation.stdin !== null && child.stdin) {
			child.stdin.on("error", () => {
				// The child may exit before stdin is fully written.
			});
			child.stdin.end(invocation.stdin);
		}

		child.on("error", (error) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeout);
			clearTimeout(failsafe);
			reject(error);
		});

		const timeout = setTimeout(() => {
			timedOut = true;
			terminateProcessForTimeout(child);
		}, timeoutMs);

		const failsafe = setTimeout(
			() => {
				finish({
					stdout,
					stderr,
					exitCode: 1,
					timedOut: true,
				});
			},
			timeoutMs + PROCESS_SIGKILL_ESCALATION_MS + 1_000,
		);

		child.on("close", (code) => {
			finish({
				stdout,
				stderr,
				exitCode: typeof code === "number" ? code : 1,
				timedOut,
			});
		});
	});
}

function wrapWithPerlDeadline(
	command: string,
	args: string[],
	timeoutMs: number,
	isBinaryAvailable: (binary: string) => boolean,
): { command: string; args: string[] } {
	if (process.platform === "win32" || !isBinaryAvailable("perl")) {
		return { command, args };
	}
	const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
	return {
		command: "perl",
		args: ["-e", `alarm ${seconds}; exec @ARGV`, command, ...args],
	};
}

function assertSafeInvocation(invocation: PanelSeatInvocation): PanelSeatInvocation {
	for (const flag of invocation.args) {
		if ((PANEL_REVIEW_FORBIDDEN_FLAGS as readonly string[]).includes(flag)) {
			throw new Error(`Refusing to dispatch a panel seat with ${flag}.`);
		}
		if (invocation.family === "gpt" && (flag === "-m" || flag === "--model")) {
			throw new Error("Refusing to pin a Codex model with -m.");
		}
		if (invocation.family === "gemini" && flag === "--mode") {
			throw new Error("Refusing to dispatch agy with --mode.");
		}
	}
	return invocation;
}

function formatPrintTimeout(timeoutMs: number): string {
	return `${Math.max(1, Math.round(timeoutMs / 1000))}s`;
}

function stripLeadingMarkup(line: string): string {
	return line
		.replace(/^[\s*`#]+/, "")
		.replace(/`+$/, "")
		.trim();
}

function extractTopRiskNote(lines: string[], verdictIndex: number): string | undefined {
	let inRisks = false;
	for (const line of lines.slice(verdictIndex + 1)) {
		const stripped = stripLeadingMarkup(line);
		if (/^TOP_RISKS:/i.test(stripped)) {
			inRisks = true;
			continue;
		}
		if (!inRisks) {
			continue;
		}
		if (/^[A-Z][A-Z0-9_]*:/.test(stripped)) {
			break;
		}
		if (!stripped) {
			continue;
		}
		const item = stripped.replace(/^-\s*/, "").trim();
		if (!item || /^none$/i.test(item)) {
			continue;
		}
		return truncatePanelSeatNote(item);
	}
	return undefined;
}

function truncatePanelSeatNote(note: string): string {
	const collapsed = note.replace(/\s+/g, " ").trim();
	if (collapsed.length <= PANEL_REVIEW_NOTE_MAX_CHARS) {
		return collapsed;
	}
	return `${collapsed.slice(0, PANEL_REVIEW_NOTE_MAX_CHARS - 1)}…`;
}

function tailText(text: string): string {
	const lines = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	return lines.slice(-3).join(" ");
}

async function readOptionalText(path: string): Promise<string> {
	try {
		return await readFile(path, "utf8");
	} catch {
		return "";
	}
}

interface ScoredGeminiModel {
	id: string;
	version: number[];
	flavor: number;
	high: number;
}

function scoreGeminiModel(id: string): ScoredGeminiModel | null {
	const match = /^gemini-(\d+(?:\.\d+)*)(?:-([a-z0-9]+))?(?:-(high))?$/i.exec(id.trim());
	if (!match) {
		return null;
	}
	const version = (match[1] ?? "0").split(".").map((part) => Number.parseInt(part, 10));
	const flavorName = (match[2] ?? "").toLowerCase();
	const flavor = flavorName === "pro" ? 2 : flavorName === "flash" ? 1 : 0;
	const high = match[3] ? 1 : 0;
	return { id: id.trim(), version, flavor, high };
}

function compareGeminiModels(left: ScoredGeminiModel, right: ScoredGeminiModel): number {
	const length = Math.max(left.version.length, right.version.length);
	for (let index = 0; index < length; index += 1) {
		const delta = (right.version[index] ?? 0) - (left.version[index] ?? 0);
		if (delta !== 0) {
			return delta;
		}
	}
	if (right.flavor !== left.flavor) {
		return right.flavor - left.flavor;
	}
	return right.high - left.high;
}
