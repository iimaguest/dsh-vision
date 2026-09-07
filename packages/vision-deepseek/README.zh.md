---
description: "DeepSeek 支持的 VisionViewProvider，面向选择、组合或排查 OpenAI 兼容 chat-completions 图像检查的使用者与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-vision-deepseek

[English](README.md) | 中文

## 概述

`dsh-vision-deepseek` 是 harness 的 [DeepSeek](https://deepseek.com) 支持的 `VisionViewProvider`，服务于[视觉能力 seam](../vision/README.zh.md)（`ctx.vision`）。它调用 DeepSeek 的 **OpenAI 兼容 chat-completions API**（`POST {baseURL}/chat/completions`），关闭 thinking，并发送一张内联 `image_url`，再把助手文本映射为 seam 的 `VisionViewResult`。它向 `ctx.vision` 注册提供方，通过可选的 `ctx.credentials` seam 为每次检查解析凭据，并在存在发起请求的 agent 会话时记录该辅助请求。当部署应通过 DeepSeek 检查图像、而无需会话路由声明图像输入时，挂载它。

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

当 DeepSeek 应为图像检查提供能力时，把 `dsh-vision-deepseek` 挂载在视觉 seam 旁。它是一个**实现**包：向 `ctx.vision` 注册提供方，且不注册面向模型的工具。与 `@deepseek-ai/dsh-web-search-deepseek` 一样，它是函数／命名空间插件（`inject: ['vision']`）。chat-completions 协议格式是提供方私有细节，并**不**使该提供方依赖 `ctx.llm`。

### 与会话视觉的区别

会话图像输入经由 `ctx.llm` 和 DeepSeek 适配器的 Files API 传输。该提供方发起一次**独立**的单图检查调用，使用自己的 settings 段和凭据引用。v1 把请求版本作为一张内联 data URL 发送。File ID 按端点和 API 密钥作用域区分，因此仅用于视觉的密钥无法复用会话上传。

默认复用 `DEEPSEEK_API_KEY` 凭据引用（不增加密钥），并且**会**遵守 `$DEEPSEEK_BASE_URL`：视觉与会话共用 chat-completions 基址（`https://api.deepseek.com`）。它**不会**遵守 `$DEEPSEEK_SEARCH_BASE_URL`。已挂载的凭据服务具有权威性；没有该服务时，提供方会回退到启动进程的环境变量。每次检查都会解析该引用，因此在 Web 的 Models 页中存储或轮换的密钥无需重启，即可用于下一次调用。

### 配置

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `apiKey` | 未设置 | DeepSeek API 密钥字面值。优先使用 `apiKeyEnv`，避免密钥进入配置；非空字面值优先。 |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | 每次检查都会通过 `ctx.credentials` 解析该凭据引用；没有该 seam 时则从进程环境解析。值缺失时，调用以 `VISION_PROVIDER_CREDENTIAL_MISSING` 失败。 |
| `baseURL` | `https://api.deepseek.com` | chat-completions 端点基址；追加 `/chat/completions`。缺省时回退到任一环境层中的 `$DEEPSEEK_BASE_URL`。无法解析时提供方不可用。 |
| `model` | `deepseek-v4-flash-vision-exp` | OpenAI 格式模型名称。 |
| `maxTokens` | `4096` | 生成 token 的正整数上限。 |
| `imagePixelBudget` | `640000` | `readImageRequest` 的总像素预算。 |
| `imageMaxBytes` | `1048576` | `readImageRequest` 的编码字节上限。 |

```yaml
- id: vision-deepseek
  name: '@deepseek-ai/dsh-vision-deepseek'
  config:
    apiKeyEnv: DEEPSEEK_API_KEY
    model: deepseek-v4-flash-vision-exp
```

上面的条目是 `vision-deepseek` Settings 段的 base 层：叠加其上的用户层会作用于**下一次**检查，因为提供方是按次投影该段，而不是在注册时固化它。因此端点或模型变化时，seam 的提供方选择不会闪断。`apiKey` 带有 `role('secret')`，所以它在任何一层都不会出现在 `describe()` 响应中。

`saveImage` 之后，提供方会按配置的像素与字节预算调用 `attachments.readImageRequest`。缺少或为空的助手文本会成为 `VISION_PROVIDER_ERROR`。HTTP 失败会保留提供方消息。调用方取消成为 `VISION_ABORTED`。HTTP 重定向会在联系 `Location` 目标之前被拒绝，并表现为 `VISION_PROVIDER_ERROR`。

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-vision-deepseek)是每个已接受字段的详尽来源。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

本节说明提供方如何解析凭据并记录辅助请求；可观察行为见[使用本包](#use-this-package)。

### 提供方注册

该包向 `ctx.vision` 注册一个 `VisionViewProvider`，且不注册面向模型的工具。它通过可选的 `ctx.credentials` seam 为每次检查解析凭据；没有该 seam 时，回退到启动进程的环境变量。chat-completions 协议格式保持为提供方私有细节，因此提供方不依赖 `ctx.llm`。

### 请求日志

由 agent 发起的检查会在发出请求前一刻，向相应会话追加仅用于日志的 `vision/deepseek-view-llm-request` 会话事件。其中包含已解析端点、模型、`max_tokens`、提示词文本、附件 id，以及请求版本的媒体类型、宽、高和字节长度；不包含标头、凭据和 base64 载荷。发出请求前发生凭据处理失败或取消时不会创建事件；发出请求后才发生 HTTP 或响应失败时，本次请求尝试仍保留持久记录。在 agent 之外通过程序直接调用提供方时，没有发起会话可供记录。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：提供方注册、配置 |
| [`src/provider.ts`](src/provider.ts) | chat-completions 检查执行路径 |
| [`src/types.ts`](src/types.ts) | 提供方类型与错误词汇表 |
| [`src/invariant.ts`](src/invariant.ts) | 提供方表面的不变式伴随插件 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

该提供方为视觉 seam 提供能力；阅读以下页面了解它所注册的 seam 与消费它的工具。

- [视觉 seam](../vision/README.zh.md) — 提供方注册表、选择与共享错误。
- [tool-vision](../tool-vision/README.zh.md) — 消费该提供方的面向模型 `view_image` 工具。
- [credentials](../../credentials/README.zh.md) — 提供方每次检查所解析的凭据引用 seam。
- [vision 子系统](../../../docs/subsystems/vision.zh.md) — view 请求与结果参考。

-----

<a id="model-experience"></a>
## 模型体验

### 辅助 DeepSeek 视觉请求

#### 模型所见

独立的 DeepSeek 视觉模型会收到一条用户消息：已解析提示词和一张请求版本图像。该请求不属于会话模型上下文。

#### Token 影响

每次检查都会产生独立的提供方输入与输出 token；`maxTokens` 限制生成输出。

#### KV Cache 影响

独立于会话请求缓存。只有提示词与图像都保持不变时，辅助前缀才可能稳定；提示词、模型或请求版本任一变化都会从第一个差异处阻止复用。

### 会话工具结果，间接影响

#### 模型所见

通过 [`dsh-tool-vision`](../tool-vision/README.zh.md)，会话模型会以文本形式看到辅助描述。该提供方的具体错误消息包括带有处理指引的凭据缺失消息、`DeepSeek vision credential resolution failed: <error>`、`DeepSeek vision aborted`、`DeepSeek vision request failed: <error>`、`DeepSeek returned no assistant text; the vision request produced an empty body` 和 `DeepSeek returned an unprocessable response body: <error>`；HTTP 失败保留提供方消息。错误包装属于消费方。

#### Token 影响

注册本身不产生会话 token。结果 token 随返回描述增长。

#### KV Cache 影响

只追加；新可见内容跟在可复用请求前缀之后，不会使已有 KV Cache 条目失效。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

以下限制定义该提供方何时不适合或需要特别小心。它们是当前的包约束，而非任务积压。

- **一次检查会消耗完整的 chat-completions 轮次**：延迟加上生成 token；DeepSeek 没有更便宜的检查端点。
- **动态凭据的可用性在操作内部解析**：同步的 `available()` 约定可以确认解析器存在，但无法查询异步凭据存储。因此，选中的无密钥提供方会使检查以 `VISION_PROVIDER_CREDENTIAL_MISSING` 失败；稳定的 `view_image` schema 仍保持注册。
- **v1 发送一张内联 data URL**：Files API 复用暂缓。单独的视觉密钥本来也无法共享会话 file id。
- **视觉模型可能编造 UI 结构或坐标**：工具结果是模型文本，不是实测光栅 API。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

本开发备注是维护者的工作上下文，明确不具备权威性。该提供方按设计保持为 chat-completions 实现包；Files API 复用与更便宜的检查端点仍属后续工作。

</details>
