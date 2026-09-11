# MallWork 电商生态系统与 pi 遗留迁移设计

## 1. 决策摘要

MallWork 采用“中心化控制面 + 站点侧轻量 Adapter/Connector”架构。当前 `MallWork` 工程是唯一产品运行时，继续使用 Python、AgentScope、FastAPI、React、AG-UI、SQLite、Redis、Qdrant 和 Docker Compose。旧 `Mall work` 中的 pi agent、CLI/TUI、Node.js Agent 循环和扩展运行时不进入新产品。

旧工程按“保留业务知识、重写技术实现”的原则迁移：产品愿景、OpenSpec 业务场景、平台契约、Skill 业务规则和测试边界进入新工程；pi 专属接口与 monorepo 基座仅作历史归档。

## 2. 当前状态与约束

### 2.1 新工程

`H:\Desktop\WorkPlace\Project\Cross_Big_Project\MallWork` 已运行完整 Compose，包含 API、worker、Redis、Qdrant 和 React 前端。现有能力包括：

- 消费者商品检索、推荐展示、偏好与个人 Skill；
- MainAgent、SearchAgent、TradeAgent 编排；
- AG-UI 流式响应、运行日志、断线恢复；
- Redis Streams 任务队列、重投、死信和跨进程事件；
- SQLite 交易确认、订单、库存、会话和能力版本；
- Qdrant 商品与知识检索；
- Prompt/Skill 发布治理、OTel 追踪和评测门禁；
- Docker Compose 可复现运行环境。

现有身份以 `buyer_id` 为中心，尚无 tenant、merchant、shop、store 或站点级授权模型；现有队列负责意图执行，不是持久化定时任务或工作流调度器；现有确认服务主要覆盖消费者下单和取消。

### 2.2 旧工程

`H:\Desktop\WorkPlace\Project\Cross_Big_Project\Mall work` 是 pi agent TypeScript monorepo fork，当前位于 `mall/main`。已提交历史包含 mall-skills 初版，工作区另有 7 个修改文件和 3 个未跟踪文件，主要是平台 Adapter、ZMall 能力和 AI 客服，不能在迁移前删除。

旧工程专用远端记录为 `https://github.com/up0to1/mall-work.git`；用户确认 `https://github.com/up0to1/MallWork` 是其私有仓库。GitHub 仓库路径大小写和当前远端身份须在未来推送前通过已认证网络再次核对。本阶段不 push、不修改远端。

### 2.3 运行安全约束

第一阶段不得：

- 修改新工程的 `app/`、`frontend/`、`docker/`、`.env` 或数据卷；
- 重建或重启当前 Compose 服务；
- 修改、迁移或删除现有 SQLite、Redis、Qdrant 数据；
- 删除旧工程、丢弃其未提交改动或执行破坏性 Git 命令；
- 向任何远端 push。

第一阶段开始和结束均检查 `http://127.0.0.1:8000/health` 与 `http://127.0.0.1:5173/health`。

## 3. 目标架构

### 3.1 中心控制面

MallWork 中心控制面负责：

- Tenant/Store Registry：租户、商家、店铺、站点和环境注册；
- RBAC/Policy：消费者、店员、商家管理员、平台管理员和服务身份授权；
- Capability Registry：能力、工具、Prompt、模型策略和版本治理；
- Autonomy Runtime：持久任务、定时/事件触发、工作流和恢复；
- Approval/Audit：高风险动作审批、幂等执行、审计与回滚信息；
- Observability/Evaluation：Trace、指标、Bad Case、离线评测和发布门禁；
- Deployment Control：独立站模板生成、校验、预览、部署和回滚编排。

### 3.2 Agent 分层

“AI 数字员工”是专业执行层，不是一个无限权限的通用 Agent：

- Consumer Concierge：推荐、穿搭、客服和交易协助；
- Product Researcher：趋势、竞品和选品；
- Inventory Operator：库存预警、补货和安全库存；
- Pricing Operator：价格监控、策略计算和调价建议；
- SEO/Content Operator：关键词、标题、描述和内容优化；
- Site Builder：基于标准模板生成、测试和准备部署独立站。

“AI 数字老板”是监督编排层，负责目标、预算、KPI、任务分解、风险策略、审批升级和复盘，不直接绕过业务服务写数据库。所有真实副作用通过确定性应用用例和站点 Adapter 执行。

### 3.3 Store Adapter/Connector

每个独立站或第三方平台通过统一能力协议接入。协议按能力分组，站点只声明自己实现的能力：

- Catalog：商品、SKU、类目、属性、媒体；
- Inventory：库存读取、预占、调整和补货；
- Pricing：价格、促销、币种和税费；
- Orders：订单、履约、取消、退款和售后；
- Customers：消费者身份、画像和授权；
- Content/SEO：页面、标题、描述、关键词和结构化数据；
- Marketing：活动、素材、渠道和效果数据；
- Analytics：流量、转化、销量、毛利和归因；
- Deployment：构建、预览、发布、健康检查和回滚。

ZMall 是第一个参考 Adapter；后续至少再实现一种不同平台或标准独立站 Adapter，才能证明协议不是为 ZMall 硬编码。

## 4. 迁移分类

### 4.1 重写后迁移

- 旧 README 中的产品愿景、角色和能力矩阵；
- OpenSpec 中的自主平台、商品推荐、商家运营、监控和创意场景；
- `EcommercePlatform` 的平台抽象思想；
- ZMall 商品、订单、物流、FAQ、售后接口映射；
- 401 重认证、429 重试、超时、结构化降级和元/分转换规则；
- AI 穿搭、AI 客服、选品调研的业务参数、状态和错误边界；
- 角色隔离、敏感信息过滤和离线验证场景。

迁移后的实现使用 Python 领域端口、应用用例、基础设施 Adapter 和 pytest/Vitest，不依赖 pi 类型。

### 4.2 仅作历史参考

- pi `ExtensionAPI`、`defineTool` 和事件钩子实现；
- `--role`、`--platform` CLI flag 和 CLI/TUI 交互；
- `packages/agent`、`packages/ai`、`packages/coding-agent` 和 pi 发布体系；
- `.pi` 下的 Prompt、OpenSpec 辅助 Skill 和示例扩展；
- echo、test-customer-only、test-merchant-only 验证模块；
- 单进程 daemon、本地 JSON 调度器和无 GUI/无部署假设。

这些内容不复制到新工程运行路径，只在迁移清单中保留来源和取舍说明。

## 5. 第一阶段：旧成果保护与文档迁移

### 5.1 旧成果保护

1. 记录旧仓库分支、HEAD、远端、状态、变更统计和变更文件 SHA-256。
2. 运行旧 `packages/mall-skills/test/verify-*.ts` 离线验证脚本并记录结果；测试失败不丢弃成果，而是在 checkpoint 中明确标记。
3. 将当前修改和未跟踪文件纳入一个本地 checkpoint commit。
4. 创建本地 annotated tag `legacy-pi-pre-migration-20260911`，说明这是迁移前保护点。
5. 不 push；旧工程保留原目录，直到后续迁移验收和远端备份均完成。

### 5.2 新工程文档信息架构

在新工程新增：

- `docs/product/MallWork电商生态系统蓝图.md`：产品目标、角色、能力地图和成功指标；
- `docs/architecture/中心控制面与站点接入架构.md`：控制面、Agent、数据流、Adapter 和安全边界；
- `docs/contracts/store-adapter-v1.md`：站点能力、身份上下文、幂等、错误和版本协议草案；
- `docs/migration/pi遗留资产迁移清单.md`：逐文件/能力的迁移、重写、归档或淘汰结论；
- `docs/migration/pi-openspec需求映射.md`：旧 OpenSpec requirement/scenario 到新阶段和验收门禁的映射；
- `docs/roadmap/MallWork分阶段实施路线图.md`：依赖顺序、阶段交付物和退出条件。

文档必须明确标注“已实现”“已具备底座”“规划中”“淘汰”四种状态，不能把旧 OpenSpec 的规划项表述为新项目已实现。

### 5.3 第一阶段验收

- 旧仓库有可定位的 checkpoint commit 和本地 tag；
- checkpoint 后旧仓库工作区清洁，或仅保留有书面说明的测试产物；
- 新工程只新增/修改 `docs/` 下的迁移文档；
- 每项旧 OpenSpec requirement 都能映射到新路线图或明确标记淘汰；
- 每个旧业务 Skill 都有“迁移语义、目标模块、测试来源、处理结论”；
- Store Adapter v1 草案不泄漏 ZMall 专属字段到通用核心；
- 新工程 Git 工作区清洁且文档提交可独立回滚；
- 前后端健康检查在阶段前后均为 `ok`；
- 当前 Compose 容器未因第一阶段重建或重启。

## 6. 后续阶段

1. 多租户、商家、店铺和站点注册模型；
2. Store Adapter v1 领域端口与契约测试；
3. ZMall 参考 Adapter；
4. 消费者推荐、穿搭和客服能力；
5. 持久任务、调度、工作流、审批和审计；
6. 选品、库存、动态定价和 SEO；
7. 标准独立站模板、接入 SDK 和合规检查；
8. 生成、测试、预览、审批、部署、健康验证和回滚流水线；
9. 第二平台 Adapter 与跨平台契约验证；
10. 旧仓库远端归档与本地清理决策。

每个阶段单独编写 spec、实施计划和验收证据，不把整个生态系统作为一次大改交付。

## 7. 风险与控制

- **旧成果丢失**：先 checkpoint/tag，后迁移；删除必须另行获得明确授权。
- **双运行时漂移**：pi 代码不进入生产依赖，新 MallWork 是唯一运行时。
- **把规划误当实现**：所有迁移文档使用状态标签和证据链接。
- **多租户越权**：后续所有核心实体和任务携带 `tenant_id`、`store_id` 与 actor identity；数据访问默认拒绝跨租户。
- **自主动作失控**：价格、库存、上下架、售后、营销发布和部署属于策略控制的副作用，要求幂等键、审批或授权策略及审计。
- **Adapter 被单平台绑死**：通用契约不使用 ZMall URL、状态码或 DTO；ZMall 映射只存在于基础设施实现。
- **建站部署不可恢复**：生成物先验证和预览，发布使用不可变版本，健康失败自动回滚。

## 8. 旧仓库清理门禁

旧 `Mall work` 只有同时满足以下条件后才能进入清理讨论：

1. checkpoint commit 和迁移前 tag 已存在；
2. 私有远端已验证可访问并完成备份；
3. 所有旧文档、业务规则和测试场景均有迁移清单；
4. 目标能力已在新项目实现并通过对应验收，而非仅写入路线图；
5. 用户再次明确授权删除具体目录。

第一阶段不删除旧仓库，也不把“已归档”解释为“可以自动删除”。
