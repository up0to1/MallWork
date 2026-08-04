# Mall Work Development Rules

> 本文件遵循 pi agent 的 AGENTS.md 约定，为在本仓库工作的 AI 助手与人类贡献者提供项目规则。Mall Work 是 pi agent 的电商化 fork，规则在继承 pi 上游约定基础上，聚焦二次开发的边界与电商 skill 实现规范。

## 项目概述

Mall Work 是 pi agent（https://github.com/earendil-works/pi ）的电商化 fork。在 `packages/mall-skills` 下实现电商 skill，通过 pi agent 的扩展机制（`ExtensionAPI` + 工具注册 + 事件总线）接入引擎层，与 ZMall 微服务通过 HTTP API 解耦对接。当前处于 MVP 阶段，已实现 6 个 skill 模块（echo / test-customer-only / test-merchant-only / zmall-client / ai-outfit / product-research，共 12 个工具）。

## 关键规则

- **不要修改 `packages/agent` 和 `packages/ai`**：保持 pi 引擎层与 LLM 适配层原貌，便于跟随上游 rebase。所有电商逻辑必须在 `packages/mall-skills` 下实现。
- **所有电商逻辑在 `packages/mall-skills` 下实现**：包括 skill、类型、工具、测试。产品层 rebranding 仅限 `packages/coding-agent/package.json` 的 `piConfig`。
- **每个 skill 是独立模块**：导出 `registerXxxSkill(pi: ExtensionAPI): void`（注册函数）与 `xxxSkillConfig: MallSkillConfig`（角色配置常量），命名与文件名一致。
- **新增 skill 必须在 `packages/mall-skills/src/index.ts` 的 `skillRegistry` 注册**：同时在 `mallSkillsExtension(pi)` 中调用 `registerXxxSkill(pi)`，否则不会被加载。
- **TypeScript strict 模式，禁止 `any`**：遵循 pi 上游代码质量要求，除非绝对必要不使用 `any`。

## 代码风格

- **使用 tabs 缩进**：遵循 pi 原项目约定（源码统一 tab 缩进，不要混用空格）。
- **使用 `defineTool` 定义工具**：从 `@earendil-works/pi-coding-agent` 导入 `defineTool`，从 `@earendil-works/pi-ai` 导入 `Type`（TypeBox）定义参数 schema。不要手写工具对象。
- **工具返回 `{ content, details }` 结构**：`content` 是 `[{ type: "text", text }]` 面向 LLM/用户的自然语言摘要；`details` 是结构化数据，供下游工具消费或测试断言。
- **错误不抛异常**：工具 `execute` 内部 try/catch 捕获异常，返回 `{ content: [...], details: { error, ... } }`，由调用方处理降级。
- **不使用内联 import**：禁止 `await import()` / `import("pkg").Type` 等动态导入，仅用顶层 import。
- **只使用可擦除的 TypeScript 语法**：在 `packages/*/src`、`packages/*/test` 下不使用参数属性、`enum`、`namespace`/`module`、`import =`、`export =` 等需 JS emit 的构造（Node strip-only 模式）。

## 测试规则

- **每个 skill 必须有对应的 `verify-xxx.ts` 测试**：放在 `packages/mall-skills/test/`，命名与 skill 文件对应（如 `skills/ai-outfit.ts` → `test/verify-ai-outfit.ts`）。
- **测试不依赖外部服务**：不调用真实 LLM、不依赖 ZMall 后端运行。使用 mock `ExtensionAPI`、确定性数据或注入式 fetch 函数。
- **运行测试**：
  ```bash
  node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json packages/mall-skills/test/verify-xxx.ts
  ```
- **创建/修改测试后必须运行并迭代**，直到通过。各 skill 测试独立运行，无需集成入口。
- **不运行 `npm run build` 或 `npm test`**，除非用户明确要求。

## Git 规则

- **二次开发分支**：`mall/main` 作为主线，`main` 跟踪 pi 上游，定期 `git fetch upstream && git rebase upstream/main mall/main`。
- **显式 `git add`**：使用 `git add <path1> <path2>`，不使用 `git add -A` / `git add .`（避免误提交他人改动或敏感文件）。
- **commit 格式**：`feat(mall-skills): xxx` / `fix(mall-skills): xxx` / `docs(mall-skills): xxx`，信息简洁有指向。
- **不要修改 git config**，不要执行 `git reset --hard` / `git checkout .` / `git clean -fd` / `git stash` 等破坏性命令，除非用户明确要求。
- **不主动 commit**：除非用户明确要求，仅完成代码修改。
- **不主动 push**，不在 `mall/main` 上 force push。

## 扩展点

### 新增 skill

1. 在 `packages/mall-skills/src/skills/` 下创建 `xxx.ts`。
2. 导出 `xxxSkillConfig: MallSkillConfig`（声明 `name` / `allowedRoles` / `toolNames`）。
3. 导出 `registerXxxSkill(pi: ExtensionAPI): void`，内部用 `defineTool` 定义工具并 `pi.registerTool(...)`。
4. 在 `packages/mall-skills/src/index.ts` 顶部 import，并：
   - 将 `xxxSkillConfig` 加入 `skillRegistry` 数组。
   - 在 `mallSkillsExtension(pi)` 中调用 `registerXxxSkill(pi)`。
5. 在 `packages/mall-skills/test/` 下创建 `verify-xxx.ts` 验证脚本并跑通。

### 新增角色

1. 在 `packages/mall-skills/src/types.ts` 的 `Role` 类型添加新角色字面量。
2. 将其加入 `ALL_ROLES` 常量数组。
3. 更新各 skill 的 `xxxSkillConfig.allowedRoles`，决定新角色是否可见。
4. 更新 `src/index.ts` 中 `before_agent_start` 注入的角色描述文本。
5. 同步更新 `README.md` 角色说明表与 `ARCHITECTURE.md` 权限映射表。

### 新增 ZMall API

1. 在 `packages/mall-skills/src/skills/zmall-client.ts` 内新增 `defineTool` + `pi.registerTool`。
2. 将新工具名加入 `zmallSkillConfig.toolNames`（若仍归属 zmall-client skill）。
3. 复用 `zmallRequest` 封装处理认证/重试/限流，不要绕过它直接 `fetch`。
4. 涉及价格的，用 `centsToYuan` / `yuanToCents` 转换，对外一律用元。
5. 在 `verify-zmall-client.ts` 补充测试。

## 依赖与安全

- **安装用 `npm install --ignore-scripts`**：不执行 lifecycle 脚本，遵循 pi 安全约定。
- **直接外部依赖固定精确版本**，内部 workspace 包保持 version-range。
- **凭证安全**：MVP 阶段 `~/.mall-agent/credentials.json` 明文缓存密码仅为支持 401 自动重登录，禁止在日志/错误响应中输出 token 或密码。生产化时应迁移到 refresh token / OAuth。
- 新增依赖前先检查 `package.json`，确认依赖是否已可用，不要假设库存在。

## 用户覆盖

若用户的指令与本文件任何规则冲突，先请求用户明确确认后再覆盖执行。
