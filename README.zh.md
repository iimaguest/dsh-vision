---
description: "视觉能力 Service Definition，面向选择、组合或排查与提供方无关的图像检查的使用者与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-vision

[English](README.md) | 中文

## 概述

**`VisionRuntime`**（`ctx.vision`）定义 harness 具备哪些图像检查能力：把一份持久附件发送到已配置的视觉路由并返回文本。它通过多个提供方实现，不把模型约定绑定到某个厂商的 API。本包承担 Service Definition 角色：服务、提供方注册表、选择策略、请求／结果词汇，以及 `VisionError` 分类体系。视觉检查有意成为独立 seam：它不是 web 访问，也不是 `ctx.llm`，因此辅助路由拥有自己的凭据引用、模型和端点。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当部署需要经由与提供方无关的 seam 进行图像检查时，把 `dsh-vision` 与一个检查提供方和一个消费方一起挂载。服务拥有 `ctx.vision` 注册表；提供方注册后端，消费方工具通过 `ctx.vision.view()` 执行。

### 服务 API（`ctx.vision`）

| 成员 | 语义 |
|---|---|
| `registerViewProvider(provider)` | 注册后端。id 重复时抛出 `VisionError` `VISION_DUPLICATE_PROVIDER`。返回 disposer。随调用 fiber 一并 dispose。 |
| `view(request, signal?)` | 解析检查提供方并检查一份附件。能力无法运行时抛出 `VisionError`。 |

提供方注册的是**能力**而非工具。`dsh-tool-vision` 是面向模型的名称、描述、提示词指引、JSON Schema 和呈现的唯一归属方。

### 配置

能力要么具有显式提供方 id（配置 `viewProvider`，或由环境变量 `$DSH_VISION_VIEW_PROVIDER` 提供相同字段），要么在恰好只注册一个可用提供方时自动选择。生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-vision)是每个已接受字段的详尽来源。

### 词汇

`VisionViewRequest`（`attachment`、`prompt`）→ `VisionViewResult`（`text`、`provider`、`model`）。取消作为可选的直接 `AbortSignal` 参数传给 `view()`。完整约定见 `src/types.ts`，其中也包含 `VisionError` code 分类体系。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

本节说明注册表如何在执行时选择提供方；可观察行为见[使用本包](#use-this-package)。

### 选择

选择绝不依赖注册、配置或 HMR 顺序。`view()` 会在执行时解析提供方：

| 情况 | 执行 |
|---|---|
| 已配置 id 已注册且 `available()` | 运行该提供方 |
| 已配置 id 未注册 | `VISION_PROVIDER_CONFIGURED_MISSING` |
| 已配置 id 已注册但不可用 | `VISION_PROVIDER_CONFIGURED_UNAVAILABLE` |
| 无 id，恰好一个已注册的可用提供方 | 运行该提供方 |
| 无 id，没有可用提供方 | `VISION_PROVIDER_UNAVAILABLE` |
| 无 id，多个可用提供方 | `VISION_PROVIDER_AMBIGUOUS` |

提供方自身的 `available()` 是便宜的局部检查（凭据是否存在、配置是否可解析、限额是否为正整数），且**禁止发起网络调用**。`dsh-tool-vision` 永远不会调用它。工具通过 `ctx.vision.view()` 执行，并按抛出的 code 路由。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 服务定义、提供方注册表、选择策略 |
| [`src/types.ts`](src/types.ts) | 请求／结果词汇与 `VisionError` 分类体系 |
| [`src/invariant.ts`](src/invariant.ts) | 注册表表面的不变式伴随插件 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

该 seam 把注册表与提供方、消费方分开；阅读以下页面了解该能力家族。

- [vision 组](../README.zh.md) — vision 包及其组合方式。
- [vision-deepseek](../vision-deepseek/README.zh.md) — DeepSeek chat-completions 检查提供方。
- [tool-vision](../tool-vision/README.zh.md) — 面向模型的 `view_image` 消费方。
- [vision 子系统](../../../docs/subsystems/vision.zh.md) — view 请求与结果参考。

-----

<a id="model-experience"></a>
## 模型体验

通过 `dsh-tool-vision` 间接影响；该工具会保留辅助描述，或者原样保留以下失败：已配置的提供方缺失、提供方不可用、无提供方、存在多个提供方以及 `Error: <message>`；本注册表自身不贡献提示词或 schema。

#### KV Cache 影响

不会直接导致 KV Cache 失效；请求前缀变更由上述消费方负责。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

以下限制定义该 seam 何时不适合或需要特别小心。它们是当前的包约束，而非任务积压。

- **没有观测接口**：没有提供方变更事件或能力状态查询；可用性只能通过执行 `view()` 并按抛出的 `VisionError` code 路由来观测。
- **只有一种能力类型**：目前只注册 `view`。日后若有提供方需要另一种检查操作，应新增成对的请求／结果类型，而不是扩大本次请求。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

本开发备注是维护者的工作上下文，明确不具备权威性。该 seam 按设计保持与提供方无关且观测精简；能力状态查询与更多能力类型仍属后续工作。

</details>
