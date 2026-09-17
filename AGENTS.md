This file captures tribal knowledge-the nuanced, non-obvious patterns that make the difference between a quick fix and hours of debugging.
When to add to this file:
- User had to intervene, correct, or hand-hold
- Multiple back-and-forth attempts were needed to get something working
- You discovered something that required reading many files to understand
- A change touched files you wouldn't have guessed
- Something worked differently than you expected
- User explicitly asks to add something
Proactively suggest additions when any of the above happen-don't wait to be asked.
What NOT to add: Stuff you can figure out from reading a few files, obvious patterns, or standard practices. This file should be high-signal, not comprehensive.

---

TypeScript principles
- No any types unless absolutely necessary.
- Check node_modules for external API type definitions instead of guessing.
- Prefer SDK-provided types, schemas, helpers, and model metadata over local redefinitions. For things like Cline SDK reasoning settings, use the SDK's source of truth whenever possible instead of recreating unions, support checks, or shapes in Kanban.
- NEVER use inline imports. No await import("./foo.js"), no import("pkg").Type in type positions, and no dynamic imports for types. Always use standard top-level imports.
- NEVER remove or downgrade code to fix type errors from outdated dependencies. Upgrade the dependency instead.

Code quality
- Write production-quality code, not prototypes
- Break components into small, single-responsibility files. 
- Extract shared logic into hooks and utilities. 
- Prioritize maintainability and clean architecture over speed. 
- Follow DRY principles and maintain clean architecture with clear separation of concerns.
- In `web-ui`, prefer `react-use` hooks (via `@/kanban/utils/react-use`) whenever possible
- Before adding custom utility code, evaluate whether a well-maintained third-party package can reduce complexity and long-term maintenance cost.

Architecture opinions
- Avoid thin shell wrappers that only forward props or relocate JSX for a single call site.
- Prefer extracting domain logic (state, effects, async orchestration) over presentation-only pass-through layers.
- Do not optimize for line count alone. Optimize for codebase navigability and clarity.

Git guardrails
- NEVER commit unless user asks.

GitHub issues
When reading issues:
- Always read all comments on the issue.
- Use this command to get everything in one call:
  gh issue view <number> --json title,body,comments,labels,state

When closing issues via commit:
- Include fixes #<number> or closes #<number> in the commit message. This automatically closes the issue when the commit is merged.

web-ui Stack
- Kanban web-ui uses Tailwind CSS v4 for styling, Radix UI for accessible headless primitives, and Lucide React for icons.
- Custom UI primitives live in `src/components/ui/` (button, dialog, tooltip, kbd, spinner, cn utility).
- Toast notifications use `sonner`. Import `{ toast }` from `"sonner"` or use `showAppToast` from `@/components/app-toaster`.

Styling mental model
- Use Tailwind utility classes as the primary styling system. Prefer `className` over inline `style={{}}`.
- Prefer Tailwind classes over adding custom CSS in `globals.css` when possible. Conditional Tailwind classes via `cn()` are better than CSS overrides for state-driven styling (e.g. selected/active variants). Reserve `globals.css` for things Tailwind can't express: complex selectors (sibling combinators, attribute selectors), app-level layout glue, or styles that genuinely need to cascade.
- Only use inline `style={{}}` for truly dynamic values (colors from props/variables, computed positions from drag-and-drop, runtime-dependent dimensions).
- The design system tokens are defined in `globals.css` inside `@theme { ... }`. Use Tailwind utilities that reference them: `bg-surface-0`, `text-text-primary`, `border-border`, etc.

Design tokens (defined in globals.css @theme)
- Surface hierarchy: `surface-0` (#151A1E, app bg / columns), `surface-1` (#1C2126, navbar / project col / raised), `surface-2` (#252B31, cards/inputs), `surface-3` (#31383F, hover), `surface-4` (#3F4750, pressed/scrollbars)
- Borders: `border` (#2A323A, default), `border-bright` (#414B56, more visible), `border-focus` (#1F87B5, focus rings)
- Text: `text-primary` (#E8EEF4), `text-secondary` (#8B96A2), `text-tertiary` (#6A7480)
- Accent: `accent` (#1F87B5), `accent-hover` (#3B9CC6)
- Status: `status-blue` (#4C9AFF), `status-green` (#3FB950), `status-orange` (#D29922), `status-red` (#F85149), `status-purple` (#A371F7), `status-gold` (#D4A72C)
- Border radius: `rounded-sm` (4px), `rounded-md` (6px), `rounded-lg` (8px), `rounded-xl` (12px)
- Motion: `--ease-out` cubic-bezier(0.23, 1, 0.32, 1), `--ease-in-out` cubic-bezier(0.77, 0, 0.175, 1), `--duration-fast` 120ms, `--duration-ui` 180ms, `--duration-overlay` 220ms. Animate transform/opacity only. Gate hover motion with `@media (hover: hover) and (pointer: fine)`. `prefers-reduced-motion: reduce` drops transform motion and keeps opacity/color. Never `transition: all`.

UI primitives (src/components/ui/)
- `Button` from `@/components/ui/button`: `variant="default"|"primary"|"danger"|"ghost"`, `size="sm"|"md"`, `icon={<LucideIcon />}`, `fill`, children for text content.
- `Dialog`, `DialogHeader`, `DialogBody`, `DialogFooter` from `@/components/ui/dialog`: For modals. `DialogHeader` takes a `title` string.
- `AlertDialog`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogAction`, `AlertDialogCancel` from `@/components/ui/dialog`: For destructive confirmations.
- `Tooltip` from `@/components/ui/tooltip`: `<Tooltip content="text"><trigger/></Tooltip>`.
- `Spinner` from `@/components/ui/spinner`: `size` (number), `className`.
- `Kbd` from `@/components/ui/kbd`: Keyboard shortcut display.
- `cn` from `@/components/ui/cn`: Utility for conditional className joining.

Icons
- Use `lucide-react` for all icons. Import individual icons: `import { Settings, Plus, Play } from "lucide-react"`.
- Standard icon sizes: 14px for small buttons, 16px for default contexts.
- Pass icons as JSX elements to button `icon` prop: `icon={<Settings size={16} />}`.

Radix UI primitives
- Use Radix directly for headless behavior: `@radix-ui/react-popover`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-checkbox`, `@radix-ui/react-switch`, `@radix-ui/react-collapsible`, `@radix-ui/react-select`.
- Style Radix components with Tailwind classes. Use `data-[state=checked]:` for state-driven styling.

Dark theme
- The app is always in dark theme. Colors are set via CSS custom properties in `globals.css`.
- Surface hierarchy: `bg-surface-0` (app background) -> `bg-surface-1` (raised panels) -> `bg-surface-2` (cards/inputs) -> `bg-surface-3` (hover) -> `bg-surface-4` (pressed).
- Do NOT use Blueprint, Tailwind's light-mode defaults, or any `dark:` prefix. The theme is always dark.

Panel review
- Seats are model families (`grok` | `claude` | `gpt` | `gemini`), not model IDs. Workspace default is `panelReviewEnabled` + `panelReviewFamilies`; cards override with `panelReviewMode` inherit/off/custom.
- Inherit excludes the implementing family (`grok`→grok, `claude`/`cline`→claude, `codex`→gpt, `gemini`→gemini). Custom does not exclude. If exclusion leaves zero seats, skip that run — do not invent a seat.
- `resolveEffectivePanelReview` in `src/core/panel-review.ts` is the shared resolver. Settings/CLI/UI live here; live dispatch is `src/server/panel-review-seats.ts`.
- Live seats: grok CLI (`~/.grok/bin/grok` fallback), `codex exec` (`-s read-only`, never `-m`), `agy` (`~/.local/bin/agy` fallback, never `--mode plan`), `claude -p` (reads-only tools, not the Agent tool). 90s/seat, parallel. Missing binary is `UNAVAILABLE` for that seat only. Usage-limit stderr benches the family in-memory for the process lifetime. Never `--always-approve`/`--yolo`/`--dangerously-skip-permissions`. Gemini is `agy`, not the `gemini` task-agent binary.
- Reconciler persists `pending` and does not await CLIs in the 5s card loop; `panelReviewInFlightTaskIds` skips that card until the run settles. Dispose/untrack ignores late persists. Tests inject `dispatchPanelSeats` / `runPanelReview` / `spawnSeat`.

Misc. tribal knowledge
- Kanban's native Cline agent is powered by the installed `@clinebot/core` and `@clinebot/llms` packages plus the local `src/cline-sdk/` boundary layer, so when Cline behavior is unclear, inspect those packages and `src/cline-sdk/` for the real implementation details.
- Kanban is launched from the user's shell and inherits its environment. For agent detection and task-agent startup, prefer direct PATH checks and direct process launches over spawning an interactive shell. Avoid `zsh -i`, shell fallback command discovery, or "launch shell then type command into it" on hot paths. On setups with heavy shell init like `conda` or `nvm`, doing that per task can freeze the runtime and even make new Terminal.app windows feel hung when several tasks start at once. It's fine to use an actual interactive shell for explicit shell terminals, not for normal agent session work.
- If CI hangs on Node 22 after tests seem to finish, suspect a live subprocess or SDK-host startup path before assuming a slow test body. Read `.plan/docs/node22-ci-hanging-tests-investigation.md` before repeating that investigation. `test/runtime/cline-sdk/cline-task-session-service.test.ts` was the big prior culprit because a unit-style suite was still booting the real Cline SDK host.
- When Kanban runs on a headless remote Linux instance (for example over SSH+tunnel), native folder picker commands may be unavailable (`zenity`/`kdialog`). Treat this as a normal remote-runtime limitation and use manual path entry fallback instead of requiring desktop packages.
- Stranded task worktrees: when a session dies the worktree often remains. Card detail (and `kanban task worktree --task-id`) offers Keep (`git branch recovered/<taskId> <head>`, create or update), Resume (existing start/resume path), and Discard. Discard refuses if HEAD is not reachable from any branch or tag — never delete the only copy of a commit. Kanban checkpoint refs do not count as reachable.
- Panel review is fail-closed: inherit with no seats after excluding the implementer family skips and allows auto-review; custom with zero successful seats parks (`rejected`). Types live in `src/core/panel-review.ts`.
- `--skip-shutdown-cleanup` must still stop agent PTY trees (SIGTERM process group, then SIGKILL). The flag only skips moving in-progress/review cards to Done and deleting their worktrees. Default shutdown *does* trash those cards and delete worktrees; that is product policy, not a leak — do not change it without a founder decision.
- `git worktree remove` failure must `rm` the directory *then* `git worktree prune`. Pruning while the directory still exists leaves a stale registration (`missing but already registered`) on the next add. Deletes share the per-repo setup lock with ensure so concurrent discard/delete cannot race.
