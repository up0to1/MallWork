# Mall Work — 电商通用 AI Agent

## 项目简介

Mall Work 是基于 pi agent（TypeScript/Node.js）二次开发的电商领域通用 AI Agent，实现"AI 数字员工 + AI 数字老板"的电商工作台思想。前台面向消费者，提供 AI 穿搭、智能客服、商品推荐等能力；后台面向商家运营，提供自动调研选品、库存管理、动态定价、SEO 优化等能力。项目以 pi agent 为基座，保留其引擎层与 LLM 适配层原貌，仅在产品层进行电商化改造，并通过 HTTP API 与 ZMall 微服务系统解耦对接，支持 customer / merchant / admin 三角色权限隔离与渐进式 skill 扩展。

## 竞品参考

- **Accio Work**：https://www.accio.com/

## 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│  产品层  packages/coding-agent + packages/mall-skills            │
│  电商化改造层：角色路由、电商 skill、ZMall 对接、CLI/TUI 壳       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  mall-skills：echo / test-customer-only / test-merchant-only │
│  │              zmall-client / ai-outfit / product-research    │
│  └───────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│  引擎层  packages/agent                                          │
│  pi-agent-core 原貌：agent-loop / agent 管理层 / 事件总线        │
├─────────────────────────────────────────────────────────────────┤
│  LLM 适配层  packages/ai                                        │
│  pi-ai 原貌：27 家供应商统一适配（OpenAI / Anthropic / 通义千问…）│
└─────────────────────────────────────────────────────────────────┘
```

## 核心特性

- **基于 pi agent SDK 二次开发**：保留 `packages/agent` 与 `packages/ai` 引擎层原貌，仅在产品层做电商化改造，便于跟随上游 rebase。
- **三角色权限隔离**：通过 `--role` 参数区分 `customer`（前台用户）、`merchant`（后台商家）、`admin`（平台管理员），工具白名单 + 防御性拦截双层过滤。
- **模块化 skill 扩展机制**：每个 skill 是独立模块，导出 `registerXxxSkill` 与 `xxxSkillConfig`，在 `skillRegistry` 注册，支持热加载（开发期）与配置化启禁用（运行期）。
- **与 ZMall 微服务通过 HTTP API 解耦对接**：经 hm-gateway 网关访问，封装统一 `zmallRequest` 处理认证、401 自动重登录、429 指数退避、价格元/分转换。

## 快速开始

### 环境要求

- Node.js >= 20（pi 运行时要求；`packages/coding-agent/package.json` engines 字段标注 `>=22.19.0`，建议使用 Node 22+）
- ZMall 微服务实例（用于业务对接，可选；缺失时 skill 会返回结构化降级提示）

### 安装与运行

```bash
# 1. 安装依赖（不执行 lifecycle 脚本，遵循 pi 安全约定）
npm install --ignore-scripts

# 2. 生成 LLM model data（需要网络访问各供应商目录）
npm run hydrate:model-data

# 3. 配置 LLM API Key（任选一家供应商）
#    以通义千问为例：
export QWEN_TOKEN_PLAN_CN_API_KEY="your-api-key"
#    或 OpenAI：
export OPENAI_API_KEY="your-api-key"

# 4. 以指定角色启动 agent（从源码直接运行，免构建）
node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json \
    packages/coding-agent/src/cli.ts --role customer
```

### 运行测试

```bash
# 单个验证脚本（不依赖 LLM / ZMall 外部服务）
node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json \
    packages/mall-skills/test/verify-role-routing.ts
```

完整测试清单见下方[测试](#测试)章节。

## Skill 列表

| Skill | 工具 | 角色 | 说明 |
|-------|------|------|------|
| echo | `echo` | all | 最简验证 skill，原样返回输入 |
| test-customer-only | `test_customer_only` | customer | 角色权限测试（仅 customer 可见） |
| test-merchant-only | `test_merchant_only` | merchant | 角色权限测试（仅 merchant 可见） |
| zmall-client | `zmall_login`, `query_items`, `query_item_detail` | all | ZMall API 客户端，封装认证与商品查询 |
| ai-outfit | `query_outfit`, `regenerate_outfit` | customer, admin | AI 穿搭，封装 ZMall ai-outfit 服务 |
| product-research | `fetch_market_trend`, `analyze_competitors`, `query_zmall_items`, `generate_selection_report` | merchant, admin | AI 选品调研，多工具编排生成报告 |

> 表中"all"指 customer / merchant / admin 三角色均可用。

## 角色说明

| 角色 | 标识 | 场景 | 可见 skill |
|------|------|------|-----------|
| 前台用户 | `customer` | 消费者穿搭、客服、推荐 | echo / test-customer-only / zmall-client / ai-outfit |
| 后台商家 | `merchant` | 选品、库存、定价、运营 | echo / test-merchant-only / zmall-client / product-research |
| 平台管理员 | `admin` | 全量能力 | 全部 skill |

启动时通过 `--role <role>` 指定，默认 `customer`。角色过滤在 `session_start` 事件中通过 `setActiveTools` 收紧工具白名单，并在 `tool_call` 事件中做防御性二次拦截。

## 配置

### LLM API Key

通过环境变量配置，具体变量名取决于所选供应商（pi-ai 支持 27 家）。常用：

- `QWEN_TOKEN_PLAN_CN_API_KEY`（通义千问）
- `OPENAI_API_KEY`（OpenAI）
- `ANTHROPIC_API_KEY`（Anthropic）

### ZMall 网关

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `ZMALL_GATEWAY_URL` | `http://localhost:8080` | ZMall hm-gateway 网关地址 |

### 凭证缓存

- 路径：`~/.mall-agent/credentials.json`
- 内容：JWT token、userId、username、role、gatewayUrl、loginTime
- 行为：首次 `zmall_login` 后写入；后续请求自动携带；401 时用缓存的用户名/密码自动重登录并刷新 token。

> 安全提示：MVP 阶段为支持 401 自动重登录，明文缓存了登录密码。生产环境应改用 refresh token / OAuth，不应存储明文密码。

## 测试

测试文件位于 `packages/mall-skills/test/`，均为独立验证脚本，不依赖 LLM 与 ZMall 外部服务（使用 mock 或确定性数据）。

| 测试文件 | 验证内容 | 运行命令 |
|---------|---------|---------|
| `verify-echo.ts` | mall-skills 加载、工具注册、echo 逻辑 | `node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json packages/mall-skills/test/verify-echo.ts` |
| `verify-zmall-client.ts` | 路径构建、价格转换、凭证缓存 | `node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json packages/mall-skills/test/verify-zmall-client.ts` |
| `verify-ai-outfit.ts` | 异步轮询、结果格式化、错误提示 | `node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json packages/mall-skills/test/verify-ai-outfit.ts` |
| `verify-product-research.ts` | 确定性 mock、报告生成 | `node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json packages/mall-skills/test/verify-product-research.ts` |
| `verify-role-routing.ts` | 角色白名单过滤、防御性拦截 | `node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json packages/mall-skills/test/verify-role-routing.ts` |
| `verify-integration.ts` | 端到端集成测试（8组196断言：全量加载/三角色工作流/跨工具链路/权限边界/非法角色） | `node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json packages/mall-skills/test/verify-integration.ts` |

## 项目结构

```
Mall work/
├── packages/
│   ├── ai/                          # LLM 适配层（pi-ai 原貌，勿改）
│   ├── agent/                       # 引擎层（pi-agent-core 原貌，勿改）
│   ├── tui/                         # 终端 UI 库（pi-tui 原貌）
│   ├── coding-agent/                # 产品层 CLI 壳（piConfig 已 rebrand 为 mall-agent）
│   └── mall-skills/                 # 电商 skill 包（二次开发核心）
│       ├── src/
│       │   ├── index.ts             # 扩展入口：注册 skill、角色过滤、上下文注入
│       │   ├── types.ts             # Role / MallSkillConfig 共享类型
│       │   └── skills/
│       │       ├── echo.ts                   # echo skill
│       │       ├── test-customer-only.ts     # customer 角色测试 skill
│       │       ├── test-merchant-only.ts      # merchant 角色测试 skill
│       │       ├── zmall-client.ts           # ZMall API 客户端
│       │       ├── ai-outfit.ts              # AI 穿搭 skill
│       │       └── product-research.ts       # AI 选品调研 skill
│       └── test/
│           ├── verify-echo.ts
│           ├── verify-zmall-client.ts
│           ├── verify-ai-outfit.ts
│           ├── verify-product-research.ts
│           ├── verify-role-routing.ts
│           └── verify-integration.ts
├── README.md
├── ARCHITECTURE.md
└── AGENTS.md
```

## License

MIT（继承自 pi agent 上游）

## 致谢

- **pi agent**：https://github.com/earendil-works/pi （本项目的引擎与基座来源，MIT License）
- pi agent 源码精读（中文）：https://notes.aiself.site/pi-mono?lang=zh-CN
