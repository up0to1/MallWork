---
status: phase-1-evidence
date: 2026-09-11
owners: MallWork migration
scope: legacy Pi repository preservation, verification, classification, and migration disposition
source: ../superpowers/specs/2026-09-11-mallwork-ecosystem-migration-design.md
---

# MallWork Pi 遗留资产迁移清单

_本清单证明旧成果已被本地封存，并规定每项资产如何进入新 MallWork；“存在于旧仓库”不等于“新系统已实现”。_

---

## 🔐 保护点证据

| 项目 | 记录 |
| --- | --- |
| 本地目录 | `H:\Desktop\WorkPlace\Project\Cross_Big_Project\Mall work` |
| 分支 | `mall/main` |
| 封存前 HEAD | `ff43f55c894a04ec6e7d978f0978dc29d4bef03d` |
| Checkpoint commit | `af5e6448bccc71b05a4a999173ec594342e7b7ee` |
| Commit 时间 | `2026-09-11T17:59:08+08:00` |
| Annotated tag | `legacy-pi-pre-migration-20260911` |
| Tag object | `70746aff650034c32ac790ca4f30c6c4ff92d52e` |
| 专用远端 | `mall-work` → `https://github.com/up0to1/mall-work.git` |
| 其他远端 | `origin` → `up0to1/pi-mono.git`；`upstream` → `earendil-works/pi-mono.git` |
| 推送状态 | 未推送；Phase 1 禁止 push |
| 工作树 | checkpoint 后 clean |

用户提供的私有仓库地址为 `https://github.com/up0to1/MallWork`，当前旧仓库专用远端记录为 `https://github.com/up0to1/mall-work.git`。未来备份前须通过已认证连接核对实际仓库身份、权限和默认分支；Phase 1 不修改远端。

## 📋 Checkpoint 文件清单

以下 SHA-256 在暂存和提交之前对工作树内容计算，可用于证明封存内容未被替换。

| 路径 | 原状态 | SHA-256 | 迁移语义 | 结论 |
| --- | --- | --- | --- | --- |
| `README.md` | tracked modified | `79F5892687EE3F2E1CC8893A3CB1434F37E33421E66392DD82E6B8A7C3968583` | 产品愿景、角色与能力矩阵 | 重写为产品蓝图 |
| `packages/mall-skills/src/index.ts` | tracked modified | `15126CD3573753BCE245B3547DC36B4CBAEA2CF04C7BC07562081721D8D0EA30` | 角色路由、能力注册、平台初始化 | 语义拆入控制面；Pi 钩子淘汰 |
| `packages/mall-skills/src/platform/adapters/zmall.ts` | tracked modified | `D71C3D9849A7D60C5040A945C853038CF1981E14D80E19B5DFEA5B87F1BBF919` | ZMall 商品、订单、物流、FAQ、售后映射 | Python 参考 Adapter 重实现 |
| `packages/mall-skills/src/platform/types.ts` | tracked modified | `6B14398E8A54F27A8A6EF50FCE0191B2FF2E4BEF3F29ECDF857200504E065A7D` | `EcommercePlatform` 抽象和通用类型 | 重写为 Store Adapter 领域端口 |
| `packages/mall-skills/src/skills/zmall-client.ts` | tracked modified | `3DB23459A7E698F22190243F46EAAB247E0C482F99F496835C7E58DF9E2CA209` | 登录、检索、详情和错误规则 | 业务规则移植；Pi tool 包装淘汰 |
| `packages/mall-skills/test/verify-integration.ts` | tracked modified | `520EDAD431AF0FBC2E166734088D1AF2C433956A836F92B75F2EF6E5FF017169` | 16 工具、角色、跨 Skill 工作流 | 拆为 pytest/Vitest/契约测试 |
| `packages/mall-skills/test/verify-role-routing.ts` | tracked modified | `9171263490A86CDA3F06A99A2A8D3DED776B3B15090699FC36D95895DE4F0EAE` | customer/merchant/admin 访问边界 | 移植为 RBAC 默认拒绝测试 |
| `packages/mall-skills/src/logger.ts` | untracked | `654DC5BC5296CA69BAC1A79BB69E1A91DFFFF20535ACC46874FC819084D7BEF8` | 结构化日志与敏感字段清理 | 规则并入现有观测底座 |
| `packages/mall-skills/src/skills/ai-customer-service.ts` | untracked | `C7D33315A289761B007F9E7E6B4075A20096B29F3B450FAAECDD512CC2D15081` | 订单、物流、FAQ、售后业务边界 | Consumer Concierge 中重实现 |
| `packages/mall-skills/test/verify-customer-service.ts` | untracked | `445DF6C144591AB17C92F416123B8579A03E6FE81B2B74A242575C2D8F247EF3` | 客服参数、角色和平台接口验证 | 移植为应用/Adapter 测试 |

目标阶段：平台抽象与 ZMall 映射进入 Phase 3–4；角色与客服语义进入 Phase 2–4；商家/自主能力进入 Phase 5–6。阶段定义见[实施路线图](../roadmap/MallWork分阶段实施路线图.md)。

## 🧪 离线验证结果

执行器：`node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json <script>`。验证使用旧仓库已安装依赖，没有联网、没有调用真实 ZMall、没有改变工作树。

| 脚本 | 结果 | 主要覆盖 |
| --- | --- | --- |
| `verify-echo.ts` | 通过，exit 0 | 5 组配置、注册、schema、execute、入口检查 |
| `verify-zmall-client.ts` | 通过，89/89 | 金额转换、URL、凭据路径、工具和角色映射 |
| `verify-ai-outfit.ts` | 通过，77/77 | 权限、参数校验、轮询成功/失败/超时 |
| `verify-product-research.ts` | 通过，144/144 | 趋势、竞品、报告、mock 确定性和权限 |
| `verify-customer-service.ts` | 通过，44/44 | 订单、物流、FAQ、售后和平台接口 |
| `verify-role-routing.ts` | 通过，54/54 | 三角色白名单与非法角色回退 |
| `verify-integration.ts` | 通过，212/212 | 16 工具、事件钩子、角色流与跨 Skill 编排 |

这些结果证明 checkpoint 中的旧实现自洽，不证明其生产集成、真实外部服务或新 MallWork 实现已经通过。

## 🗂️ 资产分类

### 平台抽象

| 资产 | 分类 | 新目标 | 状态 |
| --- | --- | --- | --- |
| `src/platform/types.ts` | 概念/规格重写 | Python 领域端口和共享 DTO | 规划中 |
| `src/platform/registry.ts` | Adapter 行为重实现 | Adapter/Capability Registry | 规划中 |
| `src/platform/index.ts` | 历史入口 | 由 Python composition 取代 | 淘汰 |
| `src/platform/adapters/zmall.ts` | Adapter 行为重实现 | ZMall reference Adapter | 规划中 |

可保留语义包括平台注册、健康/初始化边界、商品与订单标准化、401 重认证、429/超时、结构化降级和元/分转换。Pi `ExtensionAPI`、Node fetch 包装和 CLI 初始化方式不迁移。

### 业务 Skill

| 资产 | 分类 | 新目标 | 状态 |
| --- | --- | --- | --- |
| `skills/zmall-client.ts` | Adapter 行为重实现 | Catalog/Orders 端口与应用用例 | 规划中 |
| `skills/product-research.ts` | 概念/规格重写 | Product Researcher | 规划中 |
| `skills/ai-outfit.ts` | 概念/测试移植 | Consumer Concierge/穿搭 | 规划中 |
| `skills/ai-customer-service.ts` | 概念/测试移植 | Consumer Concierge/客服售后 | 规划中 |
| `skills/echo.ts` | 历史参考 | 无产品目标 | 淘汰 |
| `skills/test-customer-only.ts` | 测试场景移植 | RBAC 测试 fixture | 淘汰运行代码 |
| `skills/test-merchant-only.ts` | 测试场景移植 | RBAC 测试 fixture | 淘汰运行代码 |

### 验证脚本

| 资产 | 分类 | 目标测试 |
| --- | --- | --- |
| `test/verify-zmall-client.ts` | 测试场景移植 | Adapter 契约、金额、认证和错误测试 |
| `test/verify-ai-outfit.ts` | 测试场景移植 | 穿搭应用用例和异步状态测试 |
| `test/verify-product-research.ts` | 测试场景移植 | 研究服务、确定性 fixture 和报告测试 |
| `test/verify-customer-service.ts` | 测试场景移植 | 客服参数、授权和售后测试 |
| `test/verify-role-routing.ts` | 测试场景移植 | tenant/store/RBAC 负向测试 |
| `test/verify-integration.ts` | 测试场景移植 | Agent、审批、Adapter 跨层集成测试 |
| `test/verify-echo.ts` | 历史参考 | 不进入产品测试集 |

### OpenSpec 变更集

| 资产 | 分类 | 处理 |
| --- | --- | --- |
| `proposal.md` | 产品愿景来源 | 已进入产品蓝图和路线图 |
| `design.md` | 旧技术方案来源 | 业务约束保留，Pi/JSON/daemon 方案淘汰 |
| `tasks.md` | 历史执行计划 | 仅用于核对遗漏，不作为新计划 |
| `README.md` | 变更集说明 | 历史参考 |
| `specs/agent-autonomy-platform/spec.md` | 需求重写 | 映射到 Phase 5 |
| `specs/product-recommendation/spec.md` | 需求重写 | 映射到 Phase 4 |
| `specs/merchant-operations/spec.md` | 需求重写 | 映射到 Phase 6 |
| `specs/merchant-monitoring/spec.md` | 需求重写 | 映射到 Phase 5–6 |
| `specs/merchant-creative/spec.md` | 需求重写 | 映射到 Phase 6–7 |

逐 Requirement/Scenario 映射见 [Pi OpenSpec 需求映射](./pi-openspec需求映射.md)。

## 🚫 淘汰的运行假设

- `pi.ExtensionAPI`、`defineTool`、`session_start`、`tool_call` 和 `before_agent_start` 钩子
- `--role`、`--platform`、`--daemon`、`--schedule` 和 CLI/TUI 交互
- Pi monorepo 的 `packages/agent`、`packages/ai`、`packages/coding-agent` 发布链
- `.pi` Prompt/OpenSpec 辅助 Skill 与示例扩展
- 单进程 daemon、本地 JSON 调度器和无 GUI/无部署假设
- “未知工具默认放行”的旧策略；新控制面采用显式能力与默认拒绝

等价业务意图可以重写，但这些实现不得复制到新运行路径。

## 🔒 旧仓库删除门禁

旧 `Mall work` 目录只有同时满足以下条件后才能进入清理讨论：

1. Checkpoint commit 与迁移前 annotated tag 仍可验证
2. 私有远端身份与访问权限已核对，并完成 commit/tag 备份
3. 所有旧文档、业务规则、实现资产和测试场景均有迁移结论
4. 目标能力已在新 MallWork 实现并通过对应验收，而非仅存在于路线图
5. 用户再次明确授权删除具体目录

当前只满足第 1 项和清单层面的第 3 项；Phase 1 不 push、不归档、不删除。
