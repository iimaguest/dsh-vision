---
description: "The model-facing view_image tool over the vision seam, for users and maintainers choosing, composing, or debugging image inspection without conversation attachment."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-vision

English | [中文](README.zh.md)

## Summary

`dsh-tool-vision` owns the model-facing `view_image` tool over the [vision capability seam](../vision/README.md) (`ctx.vision`). It owns model-facing concerns only: the tool name, JSON schema, snake_case arguments, prompt section, filesystem admission, result formatting, and the UI presentation projection — a generic `kind: 'read'` call card with `locations: [{ path }]`. All inspection goes through `ctx.vision`; this package never imports a concrete provider. The cooperative tool-call budget is declared here via config (`timeoutMs`, attached as `ToolDefinition.timeoutMs`) and enforced by [`@deepseek-ai/dsh-tool-call-timeout-policy`](../../guard/timeout-policy/README.md). Mount it when the model should inspect a local image without attaching it to the conversation.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount `dsh-tool-vision` beside the vision seam when the model should call `view_image` to inspect a local image. The tool resolves a PNG/JPEG/WebP/GIF through `ctx.fs`, commits a durable normalized attachment, and asks the selected vision provider to inspect it, returning text.

### Tool

| Tool | Args | Behavior |
|---|---|---|
| `view_image` | `file_path` (required string), `question` (optional string) | Resolves a PNG/JPEG/WebP/GIF through `ctx.fs`, commits a durable normalized attachment, and asks the selected vision provider to inspect it. Returns text. It does not attach the image to the conversation and does not require the conversation route to declare image input. |

The tool opts into concurrent scheduling because attachment writes are content-addressed and viewing does not mutate parent-agent state.

The canonical tool value is JSON: `path`, `text`, `provider`, `model`, the committed `image` reference (attachment id, media type, bytes, width, height, optional name and original dimensions), and the opaque `targetKey`/`version` observation fields.

`output.render` emits **only** text: the resolved path, the auxiliary `provider`/`model`, and `text`. It must not emit an `ImageBlock`. `presentationMeta` carries `fsObserved` plus the attachment id.

### Configure it

| Key | Default | Meaning |
|---|---|---|
| `timeoutMs` | `60000` | Cooperative tool-call timeout budget (ms) for `view_image`. |

```yaml
- id: tool-vision
  name: '@deepseek-ai/dsh-tool-vision'
  config:
    timeoutMs: 60000
```

### Stable registration

Tool registration follows product **enablement**, not backend availability. The schema stays visible even when the selected provider is missing, misconfigured, or temporarily unavailable; the seam resolves the provider at execution time and execution fails with a structured `VisionError`. The tool still requires `ctx.attachments`: without a store there is no honest request version, so registration happens inside `ctx.inject(['attachments'], …)`.

Use `read_image` only when the current model declares image input and the pixels themselves must reach the next conversation request. `view_image` returns text.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the tool separates model-facing concerns from inspection; the observable behavior is covered in [Use this package](#use-this-package).

### The seam boundary

All inspection goes through `ctx.vision`; this package never imports a concrete provider. The tool owns only the tool name, JSON schema, arguments, prompt section, filesystem admission, result formatting, and UI projection, so the provider registry can evolve without touching the model surface.

### The view path

Execution resolves the file through `ctx.fs`, commits a durable normalized attachment, forwards `exec.signal`, and asks the selected vision provider to inspect it. The result is formatted as text; the tool never emits an `ImageBlock` and never attaches the image to the conversation.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: tool registration, schema, execution |
| [`src/view.ts`](src/view.ts) | The view execution path and result formatting |
| [`src/read-target.ts`](src/read-target.ts) | Filesystem admission and target resolution |
| [`src/session-cwd.ts`](src/session-cwd.ts) | Session working-directory resolution for the tool |
| [`src/fs-observed-meta.ts`](src/fs-observed-meta.ts) | `fsObserved` presentation metadata |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion for the tool surface |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

The tool is the model-facing half of the vision surface; read these pages for the seam it consumes and the catalog of its exact schema.

- [vision seam](../vision/README.md) — the provider registry, selection, and shared errors the tool calls.
- [vision-deepseek](../vision-deepseek/README.md) — the DeepSeek chat-completions inspection provider.
- [Generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-vision) — the exact `view_image` schema the model receives.
- [timeout-policy](../../guard/timeout-policy/README.md) — the cooperative tool-call timeout enforcement.
- [vision subsystem](../../../docs/subsystems/vision.md) — the view request and result reference.

-----

<a id="model-experience"></a>
## Model Experience

### System prompt

#### What the model sees

Vision contributes the guidance below. A scoped tool restriction does not remove this independently registered section.

##### View image guidance

```markdown
Use the view_image tool to inspect a local PNG/JPEG/WebP/GIF when the conversation model cannot take image input, or when a configured vision specialist should answer a question about the file. Use read_image only when the current model declares image input and the pixels themselves must reach the next conversation request (for example coordinate work on the attached raster). view_image returns text. It does not attach the image to the conversation.
```

#### Token effect

Fixed guidance cost per request while the tool is registered.

#### KV Cache effect

Prefix-stable while the section text is unchanged. Plugin lifecycle may invalidate reuse from the first changed prompt section.

### Tool schema

#### What the model sees

The model sees the generated [`view_image` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-vision). Timeout is a deployment setting, not a model argument.

#### Token effect

Fixed schema cost per request while the tool is visible.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged.

### View result

#### What the model sees

A successful view is exactly `<path><displayPath></path>`, `<provider><id></provider>`, `<model><id></model>`, and a `<content>` envelope carrying the auxiliary description. Failures become `Error: <message>`.

#### Token effect

Result tokens scale with the returned description; timeout policy can replace a late result with a short error.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Argument and admission errors

#### What the model sees

Stable messages include `file_path must be a non-empty string`, `cannot view "<path>": view_image only accepts PNG/JPEG/WebP/GIF paths`, `cannot view "<path>" as an image: no attachment service is mounted`, `cannot view "<path>": not found`, `cannot view "<path>": not a regular file`, and the same attachment-admission repairs `read_image` uses, with `view` in place of `read`.

#### Token effect

Only the failing call adds these retained tokens.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the tool is a poor fit or needs special care. They are current package constraints, not a task backlog.

- **Two image tools can confuse the model** — guidance keeps the split sharp: `read_image` attaches pixels; `view_image` returns prose. If models still call `read_image` on text-only routes, that is the existing refusal.
- **No vision-specific approval ships** — the call reads a local file the filesystem sandbox already confines and sends bytes to the configured endpoint. A deployment that needs confirmation adds a `tools/pre-execute` policy.
- **v1 keeps a generic read card** — `presentationMeta` may later feed a thumbnail; the conversation model still never receives an `ImageBlock`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers; it is explicitly non-authoritative. The tool stays a text-returning `view_image` by design; a thumbnail-fed card and vision-specific approval remain deferred.

</details>
