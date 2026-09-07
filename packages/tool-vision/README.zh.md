---
description: "基于视觉 seam 的面向模型 view_image 工具，面向选择、组合或排查无会话附件的图像检查的使用者与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-vision

[English](README.md) | 中文

## 概述

`dsh-tool-vision` 拥有基于[视觉能力 seam](../vision/README.zh.md)（`ctx.vision`）的面向模型 `view_image` 工具。它只负责面向模型的事项：工具名称、JSON Schema、snake_case 参数、提示词区段、文件系统准入、结果格式，以及 UI 呈现投影——带 `locations: [{ path }]` 的通用 `kind: 'read'` 调用卡片。所有检查都通过 `ctx.vision`；该包绝不导入具体提供方。协作式工具调用超时预算通过配置在此声明（`timeoutMs`，附加为 `ToolDefinition.timeoutMs`），由 [`@deepseek-ai/dsh-tool-call-timeout-policy`](../../guard/timeout-policy/README.zh.md) 强制执行。当模型应检查本地图像而无需把它附加到会话时，挂载它。

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

当模型应调用 `view_image` 检查本地图像时，把 `dsh-tool-vision` 挂载在视觉 seam 旁。该工具通过 `ctx.fs` 解析 PNG/JPEG/WebP/GIF，提交一份持久规范化附件，并让选中的视觉提供方检查它，返回文本。

### 工具

| 工具 | 参数 | 行为 |
|---|---|---|
| `view_image` | `file_path`（必填 string）、`question`（可选 string） | 通过 `ctx.fs` 解析 PNG/JPEG/WebP/GIF，提交一份持久规范化附件，并让选中的视觉提供方检查它。返回文本。它不会把图像附加到会话，也不要求会话路由声明图像输入。 |

该工具选择并发调度，因为附件写入是内容寻址的，且检查不会改变父 agent 状态。

规范工具值是 JSON：`path`、`text`、`provider`、`model`、已提交的 `image` 引用（附件 id、媒体类型、字节数、宽、高、可选名称与原始尺寸），以及不透明的 `targetKey`／`version` 观察字段。

`output.render` **只**发出文本：已解析路径、辅助 `provider`／`model` 以及 `text`。它不得发出 `ImageBlock`。`presentationMeta` 携带 `fsObserved` 和附件 id。

### 配置

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `timeoutMs` | `60000` | `view_image` 的协作式工具调用超时预算（ms）。 |

```yaml
- id: tool-vision
  name: '@deepseek-ai/dsh-tool-vision'
  config:
    timeoutMs: 60000
```

### 稳定注册

工具注册跟随产品**启用**，而不是后端可用性。即使选中的提供方缺失、配置错误或暂时不可用，schema 仍保持可见；seam 在执行时解析提供方，执行失败时抛出结构化 `VisionError`。该工具仍要求 `ctx.attachments`：没有存储就没有诚实的请求版本，因此注册发生在 `ctx.inject(['attachments'], …)` 内。

只有当前模型声明图像输入、且像素本身必须进入下一次会话请求时，才使用 `read_image`。`view_image` 返回文本。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

本节说明该工具如何把面向模型的事项与检查分开；可观察行为见[使用本包](#use-this-package)。

### seam 边界

所有检查都通过 `ctx.vision`；该包绝不导入具体提供方。工具只拥有工具名称、JSON Schema、参数、提示词区段、文件系统准入、结果格式与 UI 投影，因此提供方注册表可以演进而不触碰模型表面。

### 检查路径

执行通过 `ctx.fs` 解析文件、提交持久规范化附件、转发 `exec.signal`，并让选中的视觉提供方检查它。结果被格式化为文本；该工具绝不发出 `ImageBlock`，也绝不把图像附加到会话。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：工具注册、schema、执行 |
| [`src/view.ts`](src/view.ts) | 检查执行路径与结果格式化 |
| [`src/read-target.ts`](src/read-target.ts) | 文件系统准入与目标解析 |
| [`src/session-cwd.ts`](src/session-cwd.ts) | 该工具的会话工作目录解析 |
| [`src/fs-observed-meta.ts`](src/fs-observed-meta.ts) | `fsObserved` 呈现元数据 |
| [`src/invariant.ts`](src/invariant.ts) | 工具表面的不变式伴随插件 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

该工具是视觉表面的面向模型半部；阅读以下页面了解它所消费的 seam 与其确切 schema 的目录。

- [视觉 seam](../vision/README.zh.md) — 该工具调用的提供方注册表、选择与共享错误。
- [vision-deepseek](../vision-deepseek/README.zh.md) — DeepSeek chat-completions 检查提供方。
- [生成工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-vision) — 模型收到的确切 `view_image` schema。
- [timeout-policy](../../guard/timeout-policy/README.zh.md) — 协作式工具调用超时强制执行。
- [vision 子系统](../../../docs/subsystems/vision.zh.md) — view 请求与结果参考。

-----

<a id="model-experience"></a>
## 模型体验

### 系统提示词

#### 模型所见

视觉贡献下方指引。作用域工具限制不会移除这段独立注册的区段。

##### 查看图像指引

```markdown
Use the view_image tool to inspect a local PNG/JPEG/WebP/GIF when the conversation model cannot take image input, or when a configured vision specialist should answer a question about the file. Use read_image only when the current model declares image input and the pixels themselves must reach the next conversation request (for example coordinate work on the attached raster). view_image returns text. It does not attach the image to the conversation.
```

#### Token 影响

工具已注册时，每次请求都有固定的指引成本。

#### KV Cache 影响

区段文本不变时前缀稳定。插件生命周期可能从第一个变化的提示词区段起使复用失效。

### 工具 schema

#### 模型所见

模型会看到生成的 [`view_image` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-vision)。超时属于部署设置，不是模型参数。

#### Token 影响

工具可见时，每次请求都有固定的 schema 成本。

#### KV Cache 影响

定义与可见性不变时前缀稳定。

### 检查结果

#### 模型所见

成功的检查正好是 `<path><displayPath></path>`、`<provider><id></provider>`、`<model><id></model>`，以及携带辅助描述的 `<content>` 信封。失败成为 `Error: <message>`。

#### Token 影响

结果 token 随返回描述增长；超时策略可以用简短错误替换迟到的结果。

#### KV Cache 影响

只追加；新可见内容跟在可复用请求前缀之后，不会使已有 KV Cache 条目失效。

### 参数与准入错误

#### 模型所见

稳定消息包括 `file_path must be a non-empty string`、`cannot view "<path>": view_image only accepts PNG/JPEG/WebP/GIF paths`、`cannot view "<path>" as an image: no attachment service is mounted`、`cannot view "<path>": not found`、`cannot view "<path>": not a regular file`，以及 `read_image` 使用的同类附件准入修复消息，只是把 `read` 换成 `view`。

#### Token 影响

只有失败调用会追加这些被保留的 token。

#### KV Cache 影响

只追加；新可见内容跟在可复用请求前缀之后，不会使已有 KV Cache 条目失效。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

以下限制定义该工具何时不适合或需要特别小心。它们是当前的包约束，而非任务积压。

- **两个图像工具可能让模型混淆**：指引把分工写清楚：`read_image` 附加像素；`view_image` 返回文本。若模型仍在纯文本路由上调用 `read_image`，那是既有拒绝，不是本工具要掩盖的回归。
- **v1 不附带视觉专用审批**：该调用读取文件系统沙箱已经限制的本地文件，并把字节发送到已配置端点。需要确认的部署应添加 `tools/pre-execute` 策略。
- **v1 保持通用 read 卡片**：`presentationMeta` 日后可能供给缩略图；会话模型仍然永远收不到 `ImageBlock`。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

本开发备注是维护者的工作上下文，明确不具备权威性。该工具按设计保持返回文本的 `view_image`；缩略图供给的卡片与视觉专用审批仍属后续工作。

</details>
