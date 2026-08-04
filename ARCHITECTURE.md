# Mall Work 架构文档

## 概述

Mall Work 的架构设计围绕一个核心原则：**最大化复用 pi agent 引擎能力，最小化对上游代码的侵入**。

项目将 pi agent 的 monorepo fork 为本地二次开发基座，自上而下分为三层：产品层（电商化改造）、引擎层（pi-agent-core 原貌）、LLM 适配层（pi-ai 原貌）。所有电商业务逻辑集中在新增的 `packages/mall-skills` 包内，通过 pi agent 的扩展机制（`ExtensionAPI` + 工具注册 + 事件总线）接入引擎层，与 ZMall 业务系统则通过 HTTP API 解耦。这种分层让二次开发的改动点高度收敛，跟随 pi 上游 rebase 时冲突可控。

## 三层架构

```
┌─────────────────────────────────────────────────────────────────┐
│  产品层  packages/coding-agent + packages/mall-skills            │
│  电商化改造层：角色路由、电商 skill、ZMall 对接、CLI/TUI 壳       │
├─────────────────────────────────────────────────────────────────┤
│  引擎层  packages/agent                                          │
│  pi-agent-core 原貌：agent-loop / agent 管理层 / 事件总线        │
├─────────────────────────────────────────────────────────────────┤
│  LLM 适配层  packages/ai                                        │
│  pi-ai 原貌：27 家供应商统一适配（OpenAI / Anthropic / 通义千问…）│
└─────────────────────────────────────────────────────────────────┘
```

### LLM 适配层（`packages/ai`）

- **状态**：pi-ai 原貌，不修改。
- **职责**：统一封装 27 家 LLM 供应商的 API 差异（OpenAI、Anthropic、Google、通义千问等），向上层提供一致的 `chat` / `stream` 接口与 TypeBox schema 工具（`Type.Object` 等）。
- **二次开发约定**：禁止修改。所有供应商配置随 `npm run hydrate:model-data` 刷新 `models.generated.ts`。

### 引擎层（`packages/agent`）

- **状态**：pi-agent-core 原貌，不修改。
- **职责**：提供 agent-loop（对话循环、工具调用、状态机）、agent 管理层（会话、生命周期）、事件总线（`session_start` / `tool_call` / `before_agent_start` 等钩子）。
- **二次开发约定**：禁止修改。电商化逻辑全部通过扩展机制从外部接入。

### 产品层（`packages/coding-agent` + `packages/mall-skills`）

- **`packages/coding-agent`**：pi 的产品层 CLI 壳。二次开发仅改动 `package.json` 的 `piConfig`（`name: "mall-agent"`、`configDir: ".mall-agent"`）与 bin 名称，完成 rebranding。其余保持原貌。
- **`packages/mall-skills`**（新增包，二次开发核心）：作为 coding-agent 的内置扩展加载，承担全部电商化逻辑：
  - `src/index.ts`：扩展入口，注册 `--role` flag、注册所有 skill 工具、实现角色过滤与上下文注入。
  - `src/types.ts`：共享类型（`Role`、`MallSkillConfig`、`ALL_ROLES`、`DEFAULT_ROLE`）。
  - `src/skills/`：每个 skill 一个文件，导出 `registerXxxSkill`（注册函数）与 `xxxSkillConfig`（角色配置）。

## 角色权限系统

### 三种角色定义

| 角色 | 含义 | 默认可见 skill 范围 |
|------|------|---------------------|
| `customer` | 前台用户（消费者） | 前台能力：AI 穿搭、客服、商品推荐 |
| `merchant` | 后台商家（运营者） | 后台能力：选品调研、库存、定价、SEO |
| `admin` | 平台管理员 | 全量能力（前台 + 后台） |

角色定义在 `src/types.ts`：`type Role = "customer" | "merchant" | "admin"`，默认角色 `DEFAULT_ROLE = "customer"`。

### `--role` 参数机制

扩展入口通过 `pi.registerFlag("role", { type: "string", default: DEFAULT_ROLE })` 注册 CLI flag。启动时 `--role customer|merchant|admin` 指定当前 agent 实例角色；未指定则回落到 `customer`。`resolveRole()` 校验入参是否在 `ALL_ROLES` 内，非法值回落默认。

### 工具白名单过滤（`session_start` 事件）

在 `session_start` 事件中：

1. 解析当前角色 `currentRole = resolveRole(pi.getFlag("role"))`。
2. 读取 `pi.getActiveTools()` 获取当前已激活工具列表。
3. 用 `buildToolPermissionMap()` 构建的 `toolName → allowedRoles` 映射，过滤掉当前角色无权使用的工具。
4. 调用 `pi.setActiveTools(filteredTools)` 收紧白名单。

此层是**第一道防线**，确保未授权工具对 LLM 不可见。

### 防御性拦截（`tool_call` 事件）

在 `tool_call` 事件中再次校验 `isToolAllowed(event.toolName, currentRole, ...)`，若不在白名单则返回 `{ block: true, reason }`。此层是**第二道防线**（defense in depth），防止白名单刷新时序或绕过漏洞导致越权调用。被拦截的工具调用会被记录拒绝原因。

### 角色上下文注入（`before_agent_start` 事件）

在 `before_agent_start` 事件中注入一条 `customType: "mall-role-context"` 的消息，告知 LLM 当前角色、角色职责描述、以及"只应使用当前角色可用工具"的约束。`display: false` 表示不向用户展示。这层是**软约束**，引导 LLM 行为符合角色设定。

### 权限映射表

由 `buildToolPermissionMap()` 从 `skillRegistry` 构建，结构为 `Map<toolName, readonly Role[]>`：

| 工具 | allowedRoles | 来源 skill |
|------|--------------|-----------|
| `echo` | customer, merchant, admin | echo |
| `test_customer_only` | customer | test-customer-only |
| `test_merchant_only` | merchant | test-merchant-only |
| `zmall_login` / `query_items` / `query_item_detail` | customer, merchant, admin | zmall-client |
| `query_outfit` / `regenerate_outfit` | customer, admin | ai-outfit |
| `fetch_market_trend` / `analyze_competitors` / `query_zmall_items` / `generate_selection_report` | merchant, admin | product-research |

> 注：非 mall-skills 注册的工具（即映射表中查不到的）默认放行，避免影响 pi 内置工具。

## Skill 扩展机制

### `MallSkillConfig` 结构

每个 skill 模块导出一个 `MallSkillConfig`，声明自身权限与工具清单（定义于 `src/types.ts`）：

```ts
interface MallSkillConfig {
    name: string;                          // skill 名称
    allowedRoles: readonly Role[];         // 允许使用的角色
    toolNames: readonly string[];          // 此 skill 注册的工具名（用于角色过滤）
}
```

### `skillRegistry` 注册表

`src/index.ts` 维护一个只读数组，集中登记所有 skill 配置：

```ts
const skillRegistry: readonly MallSkillConfig[] = [
    echoSkillConfig,
    testCustomerOnlyConfig,
    testMerchantOnlyConfig,
    zmallSkillConfig,
    productResearchSkillConfig,
    aiOutfitSkillConfig,
];
```

`buildToolPermissionMap()` 遍历此表，扁平化构建 `toolName → allowedRoles` 映射供角色过滤使用。

### `buildToolPermissionMap` 映射

把 skill 级的权限配置展开为工具级映射，解耦"角色过滤"与"skill 内部结构"。角色过滤逻辑无需关心每个 skill 注册了几个工具、叫什么名字，只查映射表即可。

### 工具注册流程

每个 skill 文件遵循统一契约：导出 `registerXxxSkill(pi: ExtensionAPI)` 函数与 `xxxSkillConfig` 常量。

注册流程（`defineTool` → `registerTool`）：

1. **`defineTool({...})`**：用 pi-coding-agent 的 `defineTool` 定义工具 schema，包含 `name`、`label`、`description`、`promptSnippet`、`parameters`（TypeBox `Type.Object`）、`execute` 回调。
2. **`pi.registerTool(tool)`**：将定义好的工具注册到 pi agent 工具系统，对 LLM 可见。
3. **入口聚合**：`src/index.ts` 的 `mallSkillsExtension(pi)` 依次调用各 skill 的 `registerXxxSkill(pi)`，完成全部工具注册。

工具 `execute` 回调统一返回 `{ content: [{type:"text", text}], details: {...} }` 结构：`content` 是面向 LLM/用户的自然语言摘要，`details` 是结构化数据（供下游工具消费或测试断言）。

### 热加载说明（开发期）

MVP 阶段 skill 通过源码静态 import 加载，新增 skill 需在 `src/index.ts` 的 `skillRegistry` 与 `mallSkillsExtension` 中显式注册后重启 agent。运行期配置化启禁用（`~/.mall-agent/config.json` 的 `skills.enable/disable`）为规划能力，当前未实现。

## ZMall 对接方案

### 网关路由

所有 ZMall 调用统一指向 hm-gateway 网关（默认 `http://localhost:8080`，可通过 `ZMALL_GATEWAY_URL` 覆盖）。网关背后是 ZMall 的微服务集群：item-service（商品）、user-service（用户）、trade-service（订单）、cart-service、pay-service、dashboard-service、social-service、ai-outfit（穿搭）等。agent 不直接访问各微服务，只通过网关统一入口。

### 认证流程

1. agent 调用 `zmall_login`（POST `/users/login`）传入账号密码，ZMall user-service 校验后返回 JWT `token`、`userId`、`username`、`role` 等。
2. token 写入 `~/.mall-agent/credentials.json` 缓存。
3. 后续所有请求自动附加 `Authorization: Bearer <token>` 头。
4. 网关验证 JWT 后，将用户信息注入 `user-info` 请求头转发给下游服务（下游据此做 shopId 级数据隔离）。

### `zmallRequest` HTTP 封装

`src/skills/zmall-client.ts` 的 `zmallRequest(method, path, options)` 是所有 ZMall 调用的统一封装，处理：

- **认证附加**：从缓存读取 token，自动加 `Authorization` 头。
- **401 自动重登录**：收到 401 且非登录请求且有缓存凭证时，用缓存的用户名/密码重新登录，刷新 token 后重试原请求一次（`_skipRelogin` 标志防止递归）。
- **429 指数退避**：收到 429 时按 `1s → 2s → 4s` 退避重试，最多 3 次；仍失败则返回限流错误由 agent 决定降级。
- **超时**：10 秒（`AbortController`）。
- **错误归一化**：网络异常返回 `{ ok: false, status: 0, data: { error } }`，不抛异常，由调用方处理。

### 凭证缓存机制

- 路径：`~/.mall-agent/credentials.json`（由 `getCredentialsFilePath()` 基于 `os.homedir()` 构建）。
- 写入：首次 `zmall_login` 成功后 `saveCredentials()` 创建目录并写入 JSON。
- 读取：每次请求前 `loadCredentials()` 读取，失败返回 null（视为未登录）。
- 安全提示：为支持 401 自动重登录，缓存中保存了明文密码。MVP 实现，生产应换 refresh token / OAuth。

### 价格单位转换

ZMall 内部价格以**分（cents）**存储，对用户展示以**元（yuan）**为单位。`zmall-client.ts` 提供两个转换函数：

- `centsToYuan(cents)`：`Math.round(cents) / 100`，用于 API 响应转展示。
- `yuanToCents(yuan)`：`Math.round(yuan * 100)`，用于用户输入转 API 请求。

`buildSearchPath()` 在构建价格过滤参数时自动将用户输入的元转为分。

## AI 穿搭对接

`src/skills/ai-outfit.ts` 封装 ZMall 的 ai-outfit 服务，提供 `query_outfit`（生成）与 `regenerate_outfit`（反馈调整）两个工具。仅 customer / admin 可用。

### 异步任务模型

ai-outfit 是异步服务，生成穿搭需数秒到数十秒。工具内部实现**taskId + 轮询**模型，对 agent 透明：

1. 调用生成/反馈接口，立即返回 `{ taskId, status: "PROCESSING" }`。
2. 工具内部 `pollOutfitResult(taskId)` 轮询 `GET /api/v1/outfit/agent/result/{taskId}`，间隔 2 秒，最多 15 次（30 秒上限）。
3. 状态变为 `SUCCESS` / `FAILED` 即返回；超时则返回 `PROCESSING` 状态提示用户稍后查询。

轮询函数支持注入自定义 `fetchResult`（供测试 mock）。

### 风格驱动模式

生成接口 `POST /api/v1/outfit/agent/recommend`，请求体为风格驱动参数：

- `styleTags`：风格标签（通勤/休闲/约会/运动/商务/街头/复古/欧美/亚洲）。
- `color`：偏好颜色（中文，如"白色"）。
- `sceneDesc`：场景描述（≤50 字，如"下周面试"）。
- `note`：自然语言备注（≤50 字）。
- `systemModelGender` / `userCity`：性别与城市（天气适配）。

至少提供一个输入参数，否则返回校验错误。

### 多轮反馈机制

反馈接口 `POST /api/v1/outfit/agent/feedback`，基于原始 taskId 调整方案，支持三种模式：

- **整体重生成**：仅传 `taskId` + `feedback`（如"换一套"）。
- **规避颜色**：`dislikeColors`（英文，如 `["black","red"]`）。
- **单点替换**：指定 `outfitIndex`（0-2）+ `itemIndex`（0-5）替换具体单品。

每个原始任务最多 2 轮反馈（首次生成 + 2 次反馈）。`regenerate_outfit` 复用同一轮询逻辑获取调整结果。错误码（400/403/404/409/429/401/5xx）映射为友好中文提示，不暴露底层 HTTP 细节。

## 选品调研实现

`src/skills/product-research.ts` 为后台商家提供 AI 选品研究能力，仅 merchant / admin 可用。包含 4 个工具，由 agent 编排完成"趋势发现 → 竞品分析 → 库存匹配 → 报告生成"全链路。

### 确定性 mock 数据策略

MVP 阶段市场趋势与竞品分析**不依赖外部数据源**，使用确定性 mock：

- `hashString(input)`（djb2 变体）基于 `category|days|region` 生成种子。
- `createSeededRng(seed)`（线性同余 LCG）产出可复现的伪随机序列。
- 相同输入 → 相同输出，保证测试可断言、可复现。
- 响应中明确标注 `dataSource: "mock (MVP)"`，`fetchedAt` 固定为 `2026-01-01T00:00:00.000Z`，便于识别 mock 数据。

生产环境应替换 `generateMarketTrendData` / `generateCompetitorAnalysis` 为真实市场数据 API（生意参谋、DataEye 等）。

### 工具编排流程

agent 按 LLM 自主决策依次调用：

1. **`fetch_market_trend`**：输入品类/天数/区域，返回趋势评分、需求等级、价格区间、热门关键词、Top10 爆品清单。
2. **`analyze_competitors`**：输入品类 + 上一步的 `marketData`（或 `competitorUrls`），返回竞品数、价格分布、平均价、常见卖点/弱点、市场饱和度。
3. **`query_zmall_items`**：查询 ZMall 现有库存（直接调 `/search/list`，ZMall 不可用时返回结构化降级提示而非抛异常）。
4. **`generate_selection_report`**：汇总前三步数据，生成结构化 Markdown 报告（趋势概览 / Top10 爆品 / 竞品价格区间 / 选品建议 / 现有库存分析），含可复用的 `summary` 摘要。

数据在工具间通过 `details` 字段传递（LLM 将上一步 details 作为下一步入参）。

## 非目标（Non-goals）

本期 MVP 明确不做以下事项：

- **不重写 ZMall**：ai-outfit 等服务仅通过 HTTP 调用复用，不修改 ZMall 代码。
- **不改 TUI**：保持 pi 原生 CLI/TUI 交互，不做界面改造。
- **不做生产级部署**：不提供 Docker/K8s 编排，仅保证本地开发可运行。
- **不做 GUI**：沿用 pi 的 CLI/TUI，不实现图形界面。
- **不做所有 13 个 skill**：MVP 仅交付 ai-outfit + product-research 两个业务 skill（加测试/客户端 skill 共 6 个模块、12 个工具）。
- **不做多租户深度隔离**：admin 角色仅做平台级管理，不做商家间数据隔离的深度加固。
