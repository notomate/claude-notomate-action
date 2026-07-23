# claude-notomate-action

A GitHub Action that lets [Claude](https://www.anthropic.com/claude) respond to comments in
[notomate](https://github.com/notomate), a self-hosted note-taking app with a built-in,
GitHub-Actions-compatible workflow engine.

Whenever someone tags `@claude` in a notomate comment, this action:

1. Extracts the text after `@claude` from the comment.
2. Runs it through the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/typescript),
   with the notomate REST API exposed as an in-process MCP server (notes, comments, views,
   stats, and workflow management/dispatch/runs/vars).
3. Posts Claude's answer back as a reply in the same comment thread.

This action is invoked by notomate's own workflow engine (executed via `act`), not by
github.com — see [`examples/claude-on-comment.yml`](examples/claude-on-comment.yml) for a
workflow you can copy into a notomate workspace.

## Setup

In the notomate workspace where you want this to run, configure:

| Name | Type | Value |
|---|---|---|
| `ANTHROPIC_API_KEY` | secret | An Anthropic API key |
| `NM_API_KEY` | secret | A notomate personal API key (User Settings → API Keys) belonging to a member of the workspace |
| `NM_API_BASE_URL` | var | The notomate origin reachable from the runner, e.g. `https://notomate.example.com`. Must be the same origin notomate's own editor uses (nginx-fronted, not the `notomate-api` container directly) — `update_note` derives its collab (Hocuspocus) WebSocket endpoint from this origin's `/ws/` route |
| `NM_APP_SECRET` | secret | notomate's `APP_SECRET`. Only needed if `update_note` is used: it edits notes live in their collab room, which only trusts a JWT cookie — not the API key — so this signs one locally |
| `NM_BOT_USER_ID` | var | Id of the notomate user `NM_API_KEY` belongs to. Only needed if `update_note` is used — the collab room's permission checks (workspace membership, note ownership) run against this user id, so it must match the API key's owner or `update_note` will get "Access denied" on private/workspace notes |

Then add a workflow with an `on: comment: { types: [created] }` trigger that runs this action
— see [`examples/claude-on-comment.yml`](examples/claude-on-comment.yml).

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `anthropic-api-key` | one of these two | | Anthropic API key |
| `claude-code-oauth-token` | one of these two | | Token from `claude setup-token`, for running under a Claude subscription instead of a metered API key |
| `notomate-base-url` | yes | | Origin notomate is reachable at (nginx-fronted, same origin its own editor uses) |
| `notomate-api-key` | yes | | Notomate personal API key (`Authorization: Bearer`) |
| `notomate-app-secret` | only for `update_note` | `""` | notomate's `APP_SECRET`, used to sign a short-lived service JWT for the collab connection |
| `notomate-bot-user-id` | only for `update_note` | `""` | Id of the notomate user this action acts as when editing notes via collab (should own `notomate-api-key`) |
| `trigger-phrase` | no | `@claude` | Phrase that must appear in a comment to trigger the agent |
| `allowed-tools` | no | (full curated set) | Comma-separated notomate MCP tool names to allow |
| `max-turns` | no | `30` | Maximum agent turns |

## Outputs

| Output | Description |
|---|---|
| `conclusion` | `success`, `skipped`, or `failure` |
| `comment-id` | The id of the reply comment that was posted, if any |

## What Claude can do

The action exposes a curated subset of the notomate API as MCP tools: notes, comments
(read/update/delete — replying is handled directly by the action, not exposed as a tool, to
prevent the agent from posting stray top-level comments), views and view-objects, workspace
stats, and workflow management (including dispatch, runs, job logs, and vars). Workspace
membership, admin/instance user management, workflow secrets, workflow-files, and binary file
upload/download are intentionally out of scope for v1.

`update_note` is the one exception to "MCP tools call the REST API": it connects to notomate's
collab (Hocuspocus) server and edits the note live in its Y.Doc room, the same way notomate's
own editor does, instead of going through `PUT /notes/:id`. That means `content` must be a
TipTap/ProseMirror JSON document (notomate's raw stored format), not markdown — `create_note`
still takes markdown and lets the REST API convert it server-side.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build   # optional: tsc emit, useful for local type-checking of output; not required to run the action
```

### Packaging: composite action, no Docker, no committed dist

This ships as a **composite action** (`runs: using: composite`), the same pattern
[`anthropics/claude-code-action`](https://github.com/anthropics/claude-code-action) uses.
`@anthropic-ai/claude-agent-sdk` bundles the full Claude Code CLI plus platform binaries
(~70MB: `cli.js`, `vendor/ripgrep`, a few `.wasm` files). Two packaging strategies don't work
for this SDK:

- **A single bundled `dist/index.js` (esbuild/webpack)** — the SDK locates its own `cli.js` via
  `import.meta.url` relative to wherever its code is *actually executing from*. Bundling
  rewrites that to point at your bundle instead of `node_modules/@anthropic-ai/claude-agent-sdk/`,
  so the CLI subprocess can never be found at runtime.
- **Committing the ~70MB of vendor binaries to git** just to work around that — technically
  possible, but bloats the repo on every dependency bump.

The composite action's steps instead install real dependencies and run the TypeScript source
directly **at workflow run time**, so `@anthropic-ai/claude-agent-sdk`'s own module keeps
executing from its real location on disk and `import.meta.url` resolution stays correct:

```yaml
runs:
  using: "composite"
  steps:
    - uses: actions/setup-node@v4
      with: { node-version: ${{ inputs.node-version }} }
    - run: cd "${{ github.action_path }}" && npm ci --omit=dev
    - run: cd "${{ github.action_path }}" && npx tsx src/index.ts
```

`tsx` transpiles just the entry file (and any local `.ts` files it imports) on the fly; it does
not bundle `node_modules` dependencies, so the SDK's `sdk.mjs` is loaded unmodified from its
installed location. The trade-off vs. Docker: every workflow run re-downloads the ~70MB SDK
package via `npm ci` instead of reusing a cached image layer — acceptable given how fast `npm`
installs are on GitHub-hosted runners (and under `act`'s local Docker daemon for notomate).

Composite action inputs are **not** auto-populated as `INPUT_*` env vars the way Docker/Node20
actions are — `action.yml`'s "Run claude-notomate-action" step forwards each `${{ inputs.x }}`
explicitly via its own `env:` block, which `@actions/core.getInput()` then reads normally.

### Local end-to-end smoke test

1. Run `docker compose up -d` in a local notomate checkout and create a workspace + API key.
2. Build a fixture event file matching the `comment.created` payload shape (see `src/event.ts`).
3. Run the entrypoint directly with `GITHUB_EVENT_PATH`, `GITHUB_OUTPUT`, and the `INPUT_*` env
   vars set (note the hyphenated names need `env` rather than inline `VAR=value` in bash):

   ```bash
   touch /tmp/gh-output.txt
   env \
     GITHUB_EVENT_PATH=/tmp/fixture-event.json \
     GITHUB_OUTPUT=/tmp/gh-output.txt \
     "INPUT_ANTHROPIC-API-KEY=sk-ant-..." \
     "INPUT_NOTOMATE-BASE-URL=http://localhost:8080" \
     "INPUT_NOTOMATE-API-KEY=nm_..." \
     "INPUT_NOTOMATE-APP-SECRET=..." \
     "INPUT_NOTOMATE-BOT-USER-ID=..." \
     npx tsx src/index.ts
   ```

4. Confirm a reply comment appears in the correct thread via
   `GET /api/v1/workspaces/:id/notes/:noteId/comments`.
