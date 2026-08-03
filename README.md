# claude-notomate-action

A GitHub Action that lets [Claude](https://www.anthropic.com/claude) respond to comments and
channel messages in [notomate](https://github.com/notomate), a self-hosted note-taking app with
a built-in, GitHub-Actions-compatible workflow engine.

Whenever someone tags `@claude` in a notomate comment or channel message, this action:

1. Extracts the text after `@claude` from the comment/message.
2. Runs it through the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/typescript),
   with the notomate REST API exposed as an in-process MCP server (notes, comments, channels and
   messages, views, stats, and workflow management/dispatch/runs/vars).
3. Posts Claude's answer back as a reply in the same comment thread, or the same channel for
   messages.

Comments and channel messages are handled differently, following notomate's own transports for
each:

- **Comments** are still one-shot: the workflow engine dispatches a run per `comment.created`
  event, and the action replies once and exits.
- **Channel messages** run over notomate's real-time Socket.IO messaging service. The workflow
  engine instead dispatches a run once per **room**, the moment a channel goes from empty to
  occupied (`channel.room_created` — i.e. the first person opens it). The action joins that
  channel's Socket.IO room itself and stays connected for as long as anyone else is in it,
  responding to every `@claude`-tagged message posted while it's there: it posts a reply message
  immediately, edits it with a running status line as the agent uses tools, then edits it once
  more with the final answer. Once the room's online users drops to just this action's own
  connection (everyone else left), it disconnects and the job ends.

For triggers that aren't a comment or channel message — a `schedule` or `workflow_dispatch`
trigger, say — there's no event body to pull a command out of and nowhere to post a reply. Set
`direct-prompt` to hand the agent a fixed task instead; see
[`examples/claude-scheduled-news-digest.yml`](examples/claude-scheduled-news-digest.yml).

This action is invoked by notomate's own workflow engine (executed via `act`), not by
github.com — see [`examples/claude-on-comment.yml`](examples/claude-on-comment.yml) and
[`examples/claude-on-room.yml`](examples/claude-on-room.yml) for workflows you can copy into a
notomate workspace.

## Setup

In the notomate workspace where you want this to run, configure:

| Name | Type | Value |
|---|---|---|
| `ANTHROPIC_API_KEY` | secret | An Anthropic API key |
| `NM_API_KEY` | secret | A notomate personal API key (User Settings → API Keys) belonging to a member of the workspace |
| `NM_API_BASE_URL` | var | The notomate origin reachable from the runner, e.g. `https://notomate.example.com`. Must be the same origin notomate's own editor uses (nginx-fronted, not the `notomate-api` container directly) — the action's Socket.IO connection (channel messaging) and `update_note`'s collab (Hocuspocus) WebSocket connection both derive from this origin's `/socket.io/` and `/ws/` routes respectively, and both authenticate with `NM_API_KEY` |

Then add a workflow with an `on: comment: { types: [created] }` trigger (for note comments) or
an `on: channel: { types: [room_created] }` trigger (for channel messages) that runs this
action — see [`examples/claude-on-comment.yml`](examples/claude-on-comment.yml) and
[`examples/claude-on-room.yml`](examples/claude-on-room.yml).

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `anthropic-api-key` | one of these two | | Anthropic API key |
| `claude-code-oauth-token` | one of these two | | Token from `claude setup-token`, for running under a Claude subscription instead of a metered API key |
| `notomate-base-url` | yes | | Origin notomate is reachable at (nginx-fronted, same origin its own editor uses) |
| `notomate-api-key` | yes | | Notomate personal API key (`Authorization: Bearer`), used for the REST API, the channel messaging Socket.IO connection, and the `update_note` collab connection |
| `trigger-phrase` | no | `@claude` | Phrase that must appear in a comment or channel message to trigger the agent |
| `allowed-tools` | no | (full curated set) | Comma-separated tool names to allow. Bare names (e.g. `list_notes`) are notomate tools; fully-qualified `mcp__<server>__<tool>` names reach servers from `mcp-config` |
| `mcp-config` | no | | JSON string adding extra MCP servers alongside the built-in notomate one — see [Adding external MCP servers](#adding-external-mcp-servers) |
| `direct-prompt` | no | | Fixed task prompt used instead of extracting a command from an event, for triggers that aren't a comment/channel message (e.g. `schedule`, `workflow_dispatch`). No reply is posted anywhere; the agent uses its tools directly. See [`examples/claude-scheduled-news-digest.yml`](examples/claude-scheduled-news-digest.yml) |
| `max-turns` | no | `30` | Maximum agent turns |

## Outputs

| Output | Description |
|---|---|
| `conclusion` | `success`, `skipped`, or `failure` |
| `comment-id` | The id of the reply comment that was posted, if any (comment events only) |
| `message-id` | The id of the last reply channel message posted while joined to the room, if any (room events only) |

## What Claude can do

The action exposes a curated subset of the notomate API as MCP tools: notes, comments
(read/update/delete — replying is handled directly by the action, not exposed as a tool, to
prevent the agent from posting stray top-level comments), channels and channel messages
(list/read/update/delete, with the same restriction on posting new messages), views and
view-objects, workspace stats, and workflow management (including dispatch, runs, job logs, and
vars). Workspace membership, admin/instance user management, workflow secrets, workflow-files,
and binary file upload/download are intentionally out of scope for v1.

`update_note` is the one exception to "MCP tools call the REST API": it connects to notomate's
collab (Hocuspocus) server and edits the note live in its Y.Doc room, the same way notomate's
own editor does, instead of going through `PUT /notes/:id`. That means `content` must be a
TipTap/ProseMirror JSON document (notomate's raw stored format), not markdown — `create_note`
still takes markdown and lets the REST API convert it server-side.

## Adding external MCP servers

Besides the built-in notomate server, the agent can reach any other MCP server your workflow
sets up, via the `mcp-config` input — a JSON string in the same shape as Claude Code's own
`.mcp.json`:

```yaml
mcp-config: |
  {
    "mcpServers": {
      "yfmcp": { "command": "uvx", "args": ["yfmcp@latest"] }
    }
  }
allowed-tools: list_notes,get_note,mcp__yfmcp__yfinance_get_ticker_info,mcp__yfmcp__yfinance_search
```

A few things worth knowing:

- **stdio servers run as a subprocess of the action**, spawned with whatever `command`/`args` you
  give (`uvx`, `npx`, a Docker CLI, etc.), so any interpreter/CLI it needs (`uv`, Node, Docker) has
  to already be on the runner. Add a step *before* this action's `uses:` line to install it, and
  to pre-fetch the package itself so the agent's first tool call doesn't stall on a cold download.
- `allowed-tools` **replaces** the default rather than adding to it — once you set it, list every
  notomate tool you still want (bare names) alongside the external ones (`mcp__<server>__<tool>`).
- An external server's tools run with whatever privileges its `command` has on the runner — treat
  each one as a new trust boundary, the same as adding any other third-party dependency.

See [`examples/claude-with-external-mcp.yml`](examples/claude-with-external-mcp.yml) for a full
workflow wiring in [newsmcp](https://github.com/pranciskus/newsmcp) (world news, no API key) and
[yfinance-mcp](https://github.com/narumiruna/yfinance-mcp) (Yahoo Finance data via `uv`).

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
     npx tsx src/index.ts
   ```

4. Confirm a reply comment appears in the correct thread via
   `GET /api/v1/workspaces/:id/notes/:noteId/comments`.

For the room flow, use a fixture matching `channel.room_created` instead (see `src/event.ts`)
and open the channel in a browser tab before running the action, so there's still someone else
in the room for it to reply to — otherwise it'll see itself as the only one there and exit
immediately. Post a message tagging `@claude` in that tab and watch the reply appear (and its
status update) in real time; closing the tab should make the action disconnect and exit shortly
after.
