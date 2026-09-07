---
description: "The DeepSeek-backed VisionViewProvider for users and maintainers choosing, composing, or debugging OpenAI-compatible chat-completions image inspection."
kind: "package-reference"
---

# @deepseek-ai/dsh-vision-deepseek

English | [中文](README.zh.md)

## Summary

`dsh-vision-deepseek` is the [DeepSeek](https://deepseek.com)-backed `VisionViewProvider` for the harness [vision capability seam](../vision/README.md) (`ctx.vision`). It calls DeepSeek's **OpenAI-compatible chat-completions API** (`POST {baseURL}/chat/completions`) with thinking disabled and one inline `image_url`, then maps assistant text into the seam's `VisionViewResult`. It registers a provider into `ctx.vision`, resolves its credential for each view through the optional `ctx.credentials` seam, and records the auxiliary request in the initiating Agent session when one exists. Mount it when a deployment should inspect images through DeepSeek without the conversation route declaring image input.

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

Mount `dsh-vision-deepseek` beside the vision seam when DeepSeek should power image inspection. It is an **implementation** package: it registers a provider into `ctx.vision` and does not register a model-facing tool. Like `@deepseek-ai/dsh-web-search-deepseek`, it is a function/namespace plugin (`inject: ['vision']`). The chat-completions wire is a provider-private detail — it does **not** make this provider depend on `ctx.llm`.

### How it differs from conversation vision

Conversation image input travels through `ctx.llm` and the DeepSeek adapter's Files API. This provider makes a **separate** one-image inspection call with its own settings section and credential reference. v1 sends the request version as one inline data URL. File ids are keyed by endpoint and API-key scope, so a vision-only key could not reuse conversation uploads.

It reuses the `DEEPSEEK_API_KEY` credential reference by default (no new secret) and **does** honor `$DEEPSEEK_BASE_URL`: vision and conversation share the chat-completions base (`https://api.deepseek.com`). It does **not** honor `$DEEPSEEK_SEARCH_BASE_URL`. A mounted credentials service is authoritative; without one, the provider falls back to the launching process environment. The reference is resolved for each view, so a key stored or rotated by the Web Models page reaches the next call without a restart.

### Configure it

| Key | Default | Meaning |
|---|---|---|
| `apiKey` | omitted | Literal DeepSeek API key. Prefer `apiKeyEnv` so no secret enters configuration; a non-empty literal wins. |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | Credential reference resolved for each view through `ctx.credentials`, or from the process environment when that seam is absent. A missing value fails the call as `VISION_PROVIDER_CREDENTIAL_MISSING`. |
| `baseURL` | `https://api.deepseek.com` | Chat-completions endpoint base; `/chat/completions` is appended. Falls back to `$DEEPSEEK_BASE_URL` from any environment layer. An unparseable value makes the provider unavailable. |
| `model` | `deepseek-v4-flash-vision-exp` | OpenAI-format model name. |
| `maxTokens` | `4096` | Positive-integer upper bound on generated tokens. |
| `imagePixelBudget` | `640000` | Total-pixel budget for `readImageRequest`. |
| `imageMaxBytes` | `1048576` | Encoded-byte cap for `readImageRequest`. |

```yaml
- id: vision-deepseek
  name: '@deepseek-ai/dsh-vision-deepseek'
  config:
    apiKeyEnv: DEEPSEEK_API_KEY
    model: deepseek-v4-flash-vision-exp
```

The entry above is the base layer of the `vision-deepseek` Settings section: a user layer over it reaches the NEXT view, because the provider projects the section per call rather than capturing it at registration. The seam's provider selection therefore never flickers when an endpoint or model changes. `apiKey` carries `role('secret')`, so it never rides a `describe()` response in any layer.

After `saveImage`, the provider calls `attachments.readImageRequest` with the configured pixel and byte budgets. A missing or empty assistant text body is `VISION_PROVIDER_ERROR`. HTTP failures surface the provider message. Caller cancellation is `VISION_ABORTED`. HTTP redirects are rejected before the `Location` target is contacted and surface as `VISION_PROVIDER_ERROR`.

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-vision-deepseek) is the exhaustive source for every accepted field.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the provider resolves credentials and logs the auxiliary request; the observable behavior is covered in [Use this package](#use-this-package).

### The provider registration

The package registers a `VisionViewProvider` into `ctx.vision` with no model-facing tool. It resolves its credential for each view through the optional `ctx.credentials` seam; without one, it falls back to the launching process environment. The chat-completions wire stays a provider-private detail, so the provider does not depend on `ctx.llm`.

### Request logging

Immediately before dispatch, a view running under an initiating Agent appends the log-only `vision/deepseek-view-llm-request` session event. It contains the resolved endpoint, model, `max_tokens`, prompt text, attachment id, and request-version media type, width, height, and byte length. Headers, credentials, and base64 payloads are excluded. Credential failures and cancellations before dispatch create no event, while later HTTP or response failures leave the attempted request durable. Direct programmatic provider calls outside an Agent have no initiating session to log.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: provider registration, config |
| [`src/provider.ts`](src/provider.ts) | The chat-completions view execution path |
| [`src/types.ts`](src/types.ts) | Provider types and error vocabulary |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion for the provider surface |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

The provider powers the vision seam; read these pages for the seam it registers into and the tool that consumes it.

- [vision seam](../vision/README.md) — the provider registry, selection, and shared errors.
- [tool-vision](../tool-vision/README.md) — the model-facing `view_image` tool that consumes this provider.
- [credentials](../../credentials/README.md) — the credential-reference seam the provider resolves each view through.
- [vision subsystem](../../../docs/subsystems/vision.md) — the view request and result reference.

-----

<a id="model-experience"></a>
## Model Experience

### Auxiliary DeepSeek vision request

#### What the model sees

A separate DeepSeek vision model receives one user message: the resolved prompt and one request-version image. This request is not part of the conversation model's context.

#### Token effect

Separate provider input and output tokens are incurred for each view; `maxTokens` caps generated output.

#### KV Cache effect

Independent of the conversation request cache. The auxiliary prompt and image can form a stable prefix only when both stay identical; a changed prompt, model, or request version prevents reuse from its first difference.

### Conversation tool result, indirectly

#### What the model sees

Through [`dsh-tool-vision`](../tool-vision/README.md), the conversation model sees the auxiliary description as text. This provider's exact failures include the actionable missing-credential message, `DeepSeek vision credential resolution failed: <error>`, `DeepSeek vision aborted`, `DeepSeek vision request failed: <error>`, `DeepSeek returned no assistant text; the vision request produced an empty body`, and `DeepSeek returned an unprocessable response body: <error>`; HTTP failures preserve the provider message. The consumer owns the error wrapper.

#### Token effect

Zero direct conversation tokens from registration. Result tokens scale with the returned description.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the provider is a poor fit or needs special care. They are current package constraints, not a task backlog.

- **One view costs a full chat-completions turn** — latency plus generated tokens; DeepSeek exposes no cheaper inspection endpoint.
- **Dynamic credential availability resolves inside the operation** — the synchronous `available()` contract can establish that a resolver exists but cannot query an asynchronous credential store. A selected keyless provider therefore fails the view with `VISION_PROVIDER_CREDENTIAL_MISSING`; the stable `view_image` schema remains registered.
- **v1 sends one inline data URL** — Files API reuse is deferred. A separate vision key could not share conversation file ids anyway.
- **The vision model can hallucinate UI structure or coordinates** — the tool result is model prose, not a measured raster API.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers; it is explicitly non-authoritative. The provider stays a chat-completions implementation package by design; Files API reuse and a cheaper inspection endpoint remain deferred.

</details>
