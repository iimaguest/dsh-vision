---
description: "The vision capability Service Definition for users and maintainers choosing, composing, or debugging provider-neutral image inspection."
kind: "package-reference"
---

# dsh-vision

Standalone DeepSeek Harness vision feature repo. Install it into a profile
with:

```sh
dsh plugin --profile web add github:iimaguest/dsh-vision
```

It mounts the vision capability seam (`ctx.vision`, bundled here), the
DeepSeek vision provider (`packages/vision-deepseek`), and the model-facing
`view_image` tool (`packages/tool-vision`).

English | [中文](README.zh.md)

## Summary

The **`VisionRuntime`** (`ctx.vision`) defines WHAT image inspection the harness has — send one durable attachment to a configured vision route and return text — over multiple providers, without binding the model contract to one vendor's API. This package owns the Service Definition role: the service, provider registry, selection policy, request/result vocabulary, and the `VisionError` taxonomy. Vision is deliberately its own seam: it is not web access and it is not `ctx.llm`, so the auxiliary route has its own credential reference, model, and endpoint.

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

Mount `dsh-vision` beside a view provider and a consumer when a deployment needs image inspection over a provider-neutral seam. The service owns the `ctx.vision` registry; providers register backends, and the consumer tool executes through `ctx.vision.view()`.

### Service API (`ctx.vision`)

| Member | Semantics |
|---|---|
| `registerViewProvider(provider)` | Register a backend. Throws `VisionError` `VISION_DUPLICATE_PROVIDER` on a duplicate id. Returns a disposer. Disposed with the calling fiber. |
| `view(request, signal?)` | Resolve the view provider and inspect one attachment. Throws `VisionError` when the capability cannot run. |

Providers register **capabilities**, not tools. `dsh-tool-vision` is the only owner of model-facing names, descriptions, prompt guidance, JSON schemas, and presentation.

### Configure it

The capability has an explicit provider id (config `viewProvider`, or env `$DSH_VISION_VIEW_PROVIDER` feeding the same field), or auto-selects when exactly one usable provider is registered. The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-vision) is the exhaustive source for every accepted field.

### Vocabulary

`VisionViewRequest` (`attachment`, `prompt`) → `VisionViewResult` (`text`, `provider`, `model`). Cancellation is a direct optional `AbortSignal` argument to `view()`. See `src/types.ts` for the full contracts and the `VisionError` code taxonomy.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the registry selects a provider at execution time; the observable behavior is covered in [Use this package](#use-this-package).

### Selection

Selection never depends on registration, config, or HMR order. `view()` resolves the provider at execution time:

| Situation | Execution |
|---|---|
| configured id registered and `available()` | runs that provider |
| configured id not registered | `VISION_PROVIDER_CONFIGURED_MISSING` |
| configured id registered but unavailable | `VISION_PROVIDER_CONFIGURED_UNAVAILABLE` |
| no id, exactly one registered usable provider | runs it |
| no id, no usable provider | `VISION_PROVIDER_UNAVAILABLE` |
| no id, multiple usable providers | `VISION_PROVIDER_AMBIGUOUS` |

A provider's own `available()` is a cheap local check (credential presence, parseable config, positive integer limits) and **must not make network calls**. `dsh-tool-vision` never calls it — the tool executes through `ctx.vision.view()` and routes on the thrown codes.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Service Definition, provider registry, selection policy |
| [`src/types.ts`](src/types.ts) | Request/result vocabulary and `VisionError` taxonomy |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion for the registry surface |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

The seam separates the registry from providers and consumers; read these pages for the capability family.

- [vision group](../README.md) — the vision packages and how they compose.
- [vision-deepseek](../vision-deepseek/README.md) — the DeepSeek chat-completions view provider.
- [tool-vision](../tool-vision/README.md) — the model-facing `view_image` consumer.
- [vision subsystem](../../../docs/subsystems/vision.md) — the view request and result reference.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-vision`, which retains the auxiliary description or the exact configured-provider, unavailable-provider, no-provider, multiple-provider, and `Error: <message>` failures while this registry contributes no prompt or schema itself.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the seam is a poor fit or needs special care. They are current package constraints, not a task backlog.

- **No observation surface** — no provider-change event and no capability-status query; availability is observed only by executing `view()` and routing the thrown `VisionError` codes.
- **One capability kind** — only `view` is registered. A later vendor that needs a different inspection operation adds a coordinated request/result pair rather than widening this one.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers; it is explicitly non-authoritative. The seam stays provider-neutral and observation-light by design; a capability-status query and additional capability kinds remain deferred.

</details>
