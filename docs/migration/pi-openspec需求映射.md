---
status: phase-1-traceability
date: 2026-09-11
owners: MallWork migration and architecture
scope: requirement and scenario mapping from legacy general-agent-workbench OpenSpec
source: legacy repository openspec/changes/general-agent-workbench/specs
---

# MallWork Pi OpenSpec 需求映射

_覆盖旧变更集 5 份 spec、24 个 Requirement 和 59 个 Scenario；状态只描述新 MallWork。_

---

## 📋 映射口径

| 记录值 | 产品状态 | 判定方式 |
| --- | --- | --- |
| `existing` | 已实现 | 新仓库有可定位代码和验证证据 |
| `partial` | 已具备底座 | 基础设施或部分链路存在，完整需求未交付 |
| `planned` | 规划中 | 已分配目标组件和阶段，尚无实现 |
| `rejected` | 淘汰 | 业务需求明确不进入新产品 |
| `superseded` | 淘汰 | 目标保留，但旧实现方式被新架构取代 |

Phase 编号与[分阶段实施路线图](../roadmap/MallWork分阶段实施路线图.md)一致。Adapter 列采用 [Store Adapter v1](../contracts/store-adapter-v1.md) 的能力名；`—` 表示纯控制面职责。

## ⚙️ Agent autonomy platform

来源：`specs/agent-autonomy-platform/spec.md`。共 7 个 Requirement、16 个 Scenario。

### Requirement 映射

| ID | 目标组件 / Agent | Adapter | 状态 | Phase |
| --- | --- | --- | --- | --- |
| AUT-R1 自主任务调度器 | Autonomy Runtime / 数字老板 | — | `partial` | 5 |
| AUT-R2 多 agent 协同编排 | Workflow Engine / 数字老板与数字员工 | Analytics 事件 | `partial` | 5 |
| AUT-R3 持久化状态与记忆 | Workflow Store、Memory、Qdrant | — | `partial` | 5 |
| AUT-R4 通知推送 | Notification Gateway | — | `planned` | 5 |
| AUT-R5 自主动作确认与审计 | Policy/Approval/Audit | 所有写能力 | `partial` | 5 |
| AUT-R6 守护模式运行 | API/worker 服务生命周期 | — | `superseded` | 5 |
| AUT-R7 任务注册契约 | Capability/Task Registry | — | `partial` | 5 |

### Scenario 映射

| ID | 场景与新归属 | 验证门禁 |
| --- | --- | --- |
| AUT-S01 | 立即任务 → Redis task queue；现有 FIFO/重投为底座，补持久审计 | 队列顺序、幂等、耗时审计集成测试 |
| AUT-S02 | cron/interval → 持久 scheduler；角色/参数改为 tenant/store/actor 快照并执行时复核 | 时间冻结测试、重启恢复、授权撤销测试 |
| AUT-S03 | 可重试错误与并发 → 标准错误、指数退避、租户/Adapter 并发策略 | 429/超时注入、3 次上限、并发隔离测试 |
| AUT-S04 | 跨角色工作流 → `product.trending.detected` 标准事件；`shopId` 规范为 `store_id` | 事件 schema、授权、工作流进度测试 |
| AUT-S05 | 编排失败回滚 → blocked + 检查点续跑，不撤销已确定结果 | 步骤失败、人工恢复、重复副作用为零测试 |
| AUT-S06 | 任务状态持久化 → Workflow Store 和 worker 租约，不使用本地 JSON | 进程终止、租约回收、计划不丢失测试 |
| AUT-S07 | 定价决策记忆 → 可检索决策记录，引用 Pricing/Analytics 快照 | tenant/store 过滤、证据引用、保留策略测试 |
| AUT-S08 | 任务完成通知 → Notification Gateway，链接/摘要受权限过滤 | 成功/失败模板、目标授权和脱敏测试 |
| AUT-S09 | 异常推送 → 库存/爆品/定价事件按严重级别路由 | 去重、静默窗口、升级和 webhook 失败测试 |
| AUT-S10 | 高风险确认 → 通用 Operation Approval；不局限交易确认 | 快照哈希、批准/拒绝、过期与篡改测试 |
| AUT-S11 | 白名单直行 → 窄 scope、限额、有效期策略 | 越界拒绝、策略版本和撤销测试 |
| AUT-S12 | 审计完整性 → actor、触发、能力、摘要、结果、耗时和关联 ID | 字段完整性与秘密扫描测试 |
| AUT-S13 | `--daemon` 启动 → 被 Compose API/worker 常驻服务取代 | worker 优雅停机和未确认任务恢复测试 |
| AUT-S14 | 对话/daemon 切换 → 被 Web/AG-UI + 后台 scheduler 并行模型取代 | 前台会话与定时任务隔离集成测试 |
| AUT-S15 | `taskRegistry` → Python Capability/Task Registry，声明 schema、角色、风险和默认触发 | 注册契约、无权触发和版本兼容测试 |
| AUT-S16 | 工具/任务共管道 → 统一应用用例 Result/Error，不沿用 Pi `{content, details}` | 同用例交互/后台两入口一致性测试 |

## 🔍 Product recommendation

来源：`specs/product-recommendation/spec.md`。共 4 个 Requirement、7 个 Scenario。

### Requirement 映射

| ID | 目标组件 / Agent | Adapter | 状态 | Phase |
| --- | --- | --- | --- | --- |
| REC-R1 商品推荐能力 | Consumer Concierge、SearchAgent | Catalog、Customers | `partial` | 4 |
| REC-R2 商品驱动推荐 | Recommendation Service | Catalog | `partial` | 4 |
| REC-R3 风格驱动推荐 | Preference/Vector Retrieval | Catalog、Customers | `partial` | 4 |
| REC-R4 推荐结果编排 | Consumer Concierge、Outfit capability | Catalog | `planned` | 4 |

### Scenario 映射

| ID | 场景与新归属 | 验证门禁 |
| --- | --- | --- |
| REC-S01 | 工具注册 → Python capability registry；customer/admin 改为明确 RBAC scope | 能力发现、角色正负向和版本测试 |
| REC-S02 | Qdrant 不可用 → 标签/分类规则降级并标明数据来源 | 向量故障注入、降级标识和质量底线测试 |
| REC-S03 | 相似商品 → Qdrant + Catalog 候选，返回价格、图片、分数和理由 | 固定索引 Top-N、租户过滤、解释字段测试 |
| REC-S04 | 搭配商品 → 类目规则与向量召回，输出关系类型 | 不兼容类目、同场景/同风格 fixture 测试 |
| REC-S05 | 画像推荐 → buyer preference/memory 底座扩展到 tenant/store 范围 | 同用户排序、跨用户隔离和理由测试 |
| REC-S06 | 风格标签推荐 → Catalog 标签过滤、相关度与销量重排 | 标签命中、稳定排序和缺货过滤测试 |
| REC-S07 | 穿搭联动 → 喜欢的单品变成种子，但不直接触发交易 | Outfit→Recommendation 链路与替换测试 |

## 📦 Merchant operations

来源：`specs/merchant-operations/spec.md`。共 5 个 Requirement、13 个 Scenario。

### Requirement 映射

| ID | 目标组件 / Agent | Adapter | 状态 | Phase |
| --- | --- | --- | --- | --- |
| OPS-R1 自动化运营 | 数字老板、Analytics Reporter | Analytics、Marketing | `planned` | 5–6 |
| OPS-R2 自动铺货上货 | Catalog Operator | Catalog | `planned` | 6 |
| OPS-R3 自动库存管理 | Inventory Operator | Inventory、Analytics | `planned` | 6 |
| OPS-R4 AI 动态定价 | Pricing Operator | Pricing、Analytics | `planned` | 6 |
| OPS-R5 工具注册与权限 | RBAC/Policy/Capability Registry | 所有商家写能力 | `partial` | 2、5–6 |

### Scenario 映射

| ID | 场景与新归属 | 验证门禁 |
| --- | --- | --- |
| OPS-S01 | 日报 → scheduler 聚合 Analytics/Orders/Inventory 后通知 | 固定数据聚合、环比、异常与准时触发测试 |
| OPS-S02 | 规则命中自动动作 → 数字老板工作流 + Policy/Approval | 连续三日规则、确认分支和审计测试 |
| OPS-S03 | 批量录入 → `catalog.batch_upsert_products`，逐项结果 | CSV/结构化输入、部分失败、幂等重试测试 |
| OPS-S04 | 属性补全 → Catalog Operator 生成带 `ai_inferred` 来源的草稿 | 缺字段、置信度、人工复核和版本冲突测试 |
| OPS-S05 | 图片处理 → 媒体生成/校验异步操作后绑定 Catalog | 尺寸/背景校验、失败隔离和资产溯源测试 |
| OPS-S06 | 库存预警 → Inventory 快照与安全库存比较后发事件 | 阈值边界、陈旧快照和通知去重测试 |
| OPS-S07 | 补货建议 → 销量预测、采购周期、断货风险排序 | 固定预测 fixture、优先级和解释测试 |
| OPS-S08 | 动态安全库存 → 提议写入 `inventory.set_safety_stock` | 波动规则、审批策略、版本和审计测试 |
| OPS-S09 | 竞品价格监控 → Product Researcher + Pricing/外部数据 | 周期、数据来源、过期与价格区间测试 |
| OPS-S10 | 定价策略 → Pricing Operator 计算，批准后 `pricing.set_price` | 毛利下限、金额单位、审批、并发冲突测试 |
| OPS-S11 | 促销调价 → 持久开始/结束工作流和原价版本记录 | 时间边界、重复触发、恢复原价与失败恢复测试 |
| OPS-S12 | merchant/admin 权限 → tenant/store 范围 RBAC，customer 默认拒绝 | 三角色、跨店铺和服务身份负向测试 |
| OPS-S13 | 商品/价格/库存写确认 → 通用 Approval 或窄白名单 | 操作前后状态、批准绑定和审计查询测试 |

## 📊 Merchant monitoring

来源：`specs/merchant-monitoring/spec.md`。共 4 个 Requirement、10 个 Scenario。

### Requirement 映射

| ID | 目标组件 / Agent | Adapter | 状态 | Phase |
| --- | --- | --- | --- | --- |
| MON-R1 爆品监控与推送 | Monitoring Agent、Product Researcher | Analytics、Inventory | `planned` | 5–6 |
| MON-R2 SEO 关键词监控 | SEO/Content Operator | Content/SEO、Analytics | `planned` | 6 |
| MON-R3 SEO 内容自动优化 | SEO/Content Operator | Content/SEO | `planned` | 6 |
| MON-R4 注册、权限与调度 | Registry、RBAC、Autonomy Runtime | — | `planned` | 2、5–6 |

### Scenario 映射

| ID | 场景与新归属 | 验证门禁 |
| --- | --- | --- |
| MON-S01 | 销量异常 → 每店铺周期快照与历史基线比较 | 时间窗、上涨/下跌阈值和缺失数据测试 |
| MON-S02 | 爆品识别 → 增速/转化规则附库存与建议动作 | 阈值边界、误报回放和解释字段测试 |
| MON-S03 | 主动推送 → Notification Gateway 输出链接、指标和建议 | 授权链接、去重、频控和失败通道测试 |
| MON-S04 | 与选品/客服协同 → 标准 `product.trending.detected` 事件 | event_id 去重、store 范围和订阅权限测试 |
| MON-S05 | 关键词排名 → Content/SEO 与 Analytics 周期采集 | 排名趋势、数据水位和变化告警测试 |
| MON-S06 | 关键词机会 → 流量上涨且覆盖缺口生成建议 | 覆盖判定、证据链接和低置信度测试 |
| MON-S07 | 标题/描述草案 → `content.save_draft`，发布另行审批 | 关键词约束、理由、长度和草稿版本测试 |
| MON-S08 | 优化效果 → 发布前后同窗口 Analytics 对比 | 对照窗口、归因限制和审计关联测试 |
| MON-S09 | merchant/admin 可见 → capability scope，customer 拒绝 | 角色与跨租户负向测试 |
| MON-S10 | 自主调度 → 持久任务、每次结果/告警审计 | 重启恢复、错过周期和重复运行测试 |

## 🎨 Merchant creative

来源：`specs/merchant-creative/spec.md`。共 4 个 Requirement、13 个 Scenario。

### Requirement 映射

| ID | 目标组件 / Agent | Adapter | 状态 | Phase |
| --- | --- | --- | --- | --- |
| CRE-R1 AI 模特 | Creative Operator | Catalog、Marketing | `planned` | 6 |
| CRE-R2 AI 广告 | Creative/Marketing Operator | Marketing、Analytics | `planned` | 6 |
| CRE-R3 AI 自动推流 | Creative Operator、Autonomy Runtime | Marketing | `planned` | 6–7 |
| CRE-R4 注册、权限与风险 | Registry、RBAC、Policy/Audit | Marketing | `planned` | 2、5–6 |

### Scenario 映射

| ID | 场景与新归属 | 验证门禁 |
| --- | --- | --- |
| CRE-S01 | 换模特图 → 异步媒体生成，复用服务能力而非 Pi tool | 操作状态、输入授权、结果 URL 和失败测试 |
| CRE-S02 | 场景图 → 生成资产记录模型、参数和来源 | 固定参数、元数据、内容安全和租户隔离测试 |
| CRE-S03 | 结果管理 → 标准 operation + 资产列表/错误 + 审计 | 成功/失败/超时、恢复查询和秘密扫描测试 |
| CRE-S04 | 广告素材 → 文案/视觉草稿和渠道/人群/预算建议 | 草稿标识、约束、品牌规则和证据测试 |
| CRE-S05 | 策略优化 → Analytics 分析 CTR/ROI/转化，只提交建议 | 固定指标、预算写操作升级和解释测试 |
| CRE-S06 | ROI 追踪 → scheduler 周期查询 Analytics/Attribution | 周期、归因窗口、缺失数据和报告测试 |
| CRE-S07 | 素材发布 → `marketing.publish_campaign` 高风险审批 | 批准快照、幂等、发布结果和失败对账测试 |
| CRE-S08 | 直播脚本 → 商品顺序绑定的结构化草稿 | schema、商品引用、敏感内容和版本测试 |
| CRE-S09 | 短视频脚本 → 分镜草稿引用已授权素材 | 素材溯源、复用权限和内容安全测试 |
| CRE-S10 | 推流调度 → 持久时间任务，启动前再次验证批准 | 时间漂移、过期审批、重复启动和取消测试 |
| CRE-S11 | 推流复盘 → Analytics 聚合观看、互动与成交 | 数据窗口、归因摘要和空数据测试 |
| CRE-S12 | merchant/admin 可见 → Creative scope，customer 拒绝 | 角色、tenant/store 和服务身份测试 |
| CRE-S13 | 生成低风险、发布高风险 → Policy 风险矩阵 + 全量审计 | 风险分类、直行边界、升级与审计完整性测试 |

## 🔍 完整性与架构替换

| Source spec | Requirement | Scenario | 映射状态 |
| --- | ---: | ---: | --- |
| `agent-autonomy-platform` | 7 | 16 | 完整 |
| `product-recommendation` | 4 | 7 | 完整 |
| `merchant-operations` | 5 | 13 | 完整 |
| `merchant-monitoring` | 4 | 10 | 完整 |
| `merchant-creative` | 4 | 13 | 完整 |
| 合计 | 24 | 59 | 完整 |

旧实现假设的替换关系：

- Pi extension/tool hooks → FastAPI/AgentScope 应用用例与 Capability Registry
- `--role`/`--platform` → 经验证的 tenant/store/actor identity 与 RBAC scope
- 单进程 daemon/本地 JSON → Compose API/worker + 持久 scheduler/workflow store
- `{content, details}` 和“不抛异常” → 统一 Result/Error 与标准错误分类
- CLI 通知 → Web/AG-UI、webhook 和后续 Notification Gateway
- ZMall 直接调用 → Store Adapter v1 + ZMall reference Adapter
- “未知工具默认放行” → 显式能力声明和默认拒绝

现有 Redis Streams、Qdrant、买家偏好、交易确认、AG-UI、Trace 和评测门禁均属于可复用底座，但不能据此把完整自主平台、商家能力或 Store Adapter 标记为已实现。
