---
status: draft-contract
version: 1.0.0-draft.1
date: 2026-09-11
owners: MallWork platform architecture
scope: platform-neutral commerce site capability contract
source: ../superpowers/specs/2026-09-11-mallwork-ecosystem-migration-design.md
---

# MallWork Store Adapter v1

_站点接入契约草案；用于后续实现领域端口、ZMall 参考 Adapter 和契约测试。_

---

## 📋 契约目标

Store Adapter 把 MallWork 的通用电商意图映射到独立站或第三方平台。控制面只依赖本契约，不依赖站点 URL、数据库表、供应商状态码或专属 DTO。Adapter 可以是控制面进程内模块，也可以是独立 Connector 服务，但可观察行为必须一致。

v1 的目标是定义能力发现、身份上下文、数据规则、读写安全、异步任务、事件、错误和一致性测试。本文不表示运行时代码已经实现。

## 🏷️ 版本与能力协商

### 版本规则

- 契约版本使用语义化版本 `major.minor.patch`
- 新增可选字段或可选能力为向后兼容的 minor 变化
- 澄清、错误修正和测试补充为 patch 变化
- 删除字段、改变既有语义或新增强制能力需要 major 变化
- Adapter 必须拒绝不支持的 major 版本，不能静默猜测
- 在同一 major 内，接收方必须忽略未知可选字段并保留必需语义

### 能力清单

每个 Adapter 暴露 `describe_capabilities()`，至少返回：

```json
{
  "adapter_id": "zmall-reference",
  "adapter_version": "0.1.0",
  "contract_versions": ["1.0"],
  "capabilities": {
    "catalog.read": {"version": "1.0", "modes": ["sync"]},
    "catalog.write": {"version": "1.0", "modes": ["sync", "async"]}
  },
  "limits": {
    "max_page_size": 100,
    "max_batch_items": 50
  }
}
```

控制面在编排前锁定本次工作流使用的契约 major、能力版本和 Adapter 版本。能力缺失返回 `unsupported`，不得通过调用相似但语义不同的接口降级写入。

## 🔐 执行上下文

每次调用必须由控制面提供且由 Adapter 验证以下上下文：

| 字段 | 必需 | 语义 |
| --- | --- | --- |
| `tenant_id` | 是 | MallWork 租户稳定 ID |
| `store_id` | 是 | 租户内站点/店铺稳定 ID |
| `actor_id` | 是 | 最终责任主体或服务身份 |
| `actor_type` | 是 | `human`、`agent` 或 `service` |
| `roles` | 是 | 当前角色集合，不由模型生成 |
| `scopes` | 是 | 允许调用的最小能力域 |
| `correlation_id` | 是 | 跨工作流与审计关联 ID |
| `request_id` | 是 | 单次调用唯一 ID |
| `idempotency_key` | 写操作是 | 同一业务意图的稳定键 |
| `approval_id` | 条件必需 | 高风险动作的有效批准凭证 |
| `policy_version` | 是 | 作出授权决定的策略版本 |

Adapter 必须校验 `tenant_id` 与 `store_id` 对应到其绑定配置，验证 scope 覆盖目标操作，并拒绝控制面未明确声明的跨店铺请求。任务恢复后执行写操作时必须重新验证当前授权和批准凭证有效期。

## 🔌 能力分组

### 操作等级

| 标记 | 含义 |
| --- | --- |
| R | 读取，无业务副作用 |
| W | 写入，必须幂等和审计 |
| S | 同步返回确定结果 |
| A | 返回异步操作句柄 |
| P | 默认进入审批/策略判断 |
| C | v1 核心一致性能力 |
| O | 可选能力，通过协商启用 |

### Catalog

| 操作 | 等级 | 用途 |
| --- | --- | --- |
| `catalog.search_products` | R/S/C | 分页检索商品/SKU |
| `catalog.get_product` | R/S/C | 按稳定 ID 读取详情与版本 |
| `catalog.upsert_product` | W/S或A/P/C | 创建或更新商品草稿/在售信息 |
| `catalog.batch_upsert_products` | W/A/P/O | 批量上货并返回逐项状态 |
| `catalog.set_publication` | W/S/P/O | 上架、下架或定时发布 |
| `catalog.attach_media` | W/S或A/P/O | 绑定已验证媒体资产 |

### Inventory

| 操作 | 等级 | 用途 |
| --- | --- | --- |
| `inventory.get_levels` | R/S/C | 读取 SKU、库位和快照时间 |
| `inventory.reserve` | W/S/P/O | 预占可售库存 |
| `inventory.release` | W/S/O | 释放指定预占 |
| `inventory.adjust` | W/S/P/O | 以原因码调整库存 |
| `inventory.set_safety_stock` | W/S/P/O | 更新安全库存阈值 |

### Pricing

| 操作 | 等级 | 用途 |
| --- | --- | --- |
| `pricing.get_prices` | R/S/C | 读取币种、标价、售价和版本 |
| `pricing.quote` | R/S/O | 计算税费/促销后的报价 |
| `pricing.set_price` | W/S/P/O | 更新价格并校验毛利/版本 |
| `pricing.schedule_promotion` | W/S或A/P/O | 安排开始、结束和恢复规则 |

### Orders

| 操作 | 等级 | 用途 |
| --- | --- | --- |
| `orders.list_orders` | R/S/C | 分页读取订单摘要 |
| `orders.get_order` | R/S/C | 读取订单、履约与版本 |
| `orders.create_order` | W/S或A/P/O | 创建订单，要求业务幂等键 |
| `orders.cancel_order` | W/S或A/P/O | 取消并返回确定/待处理状态 |
| `orders.get_fulfillment` | R/S/O | 查询物流与履约事件 |
| `orders.submit_after_sales` | W/S或A/P/O | 提交退款、换货或维修请求 |

### Customers

| 操作 | 等级 | 用途 |
| --- | --- | --- |
| `customers.resolve_identity` | R/S/C | 把外部客户映射为稳定引用 |
| `customers.get_profile` | R/S/O | 按授权读取最小画像 |
| `customers.update_consent` | W/S/P/O | 更新授权与偏好同意记录 |

### Content/SEO

| 操作 | 等级 | 用途 |
| --- | --- | --- |
| `content.get_resource` | R/S/C | 读取页面、标题、描述和版本 |
| `content.save_draft` | W/S/O | 保存不公开草稿 |
| `content.publish` | W/S或A/P/O | 发布已审核内容 |
| `content.get_search_metrics` | R/S/O | 读取关键词、曝光和排名数据 |
| `content.set_structured_data` | W/S/P/O | 更新结构化数据 |

### Marketing

| 操作 | 等级 | 用途 |
| --- | --- | --- |
| `marketing.list_campaigns` | R/S/O | 读取活动、预算和状态 |
| `marketing.save_creative_draft` | W/S或A/O | 保存未发布素材草案 |
| `marketing.publish_campaign` | W/A/P/O | 发布或启动投放 |
| `marketing.adjust_budget` | W/S/P/O | 调整渠道预算 |

### Analytics

| 操作 | 等级 | 用途 |
| --- | --- | --- |
| `analytics.query_metrics` | R/S/C | 查询流量、转化、销量和毛利 |
| `analytics.query_attribution` | R/S/O | 查询渠道归因与窗口 |
| `analytics.get_snapshot` | R/S/O | 获取带水位线的一致性快照 |

### Deployment

| 操作 | 等级 | 用途 |
| --- | --- | --- |
| `deployment.validate_artifact` | R/S/C | 验证不可变构建物和清单 |
| `deployment.create_preview` | W/A/O | 创建隔离预览环境 |
| `deployment.release` | W/A/P/O | 发布指定不可变版本 |
| `deployment.health_check` | R/S/C | 检查发布目标健康 |
| `deployment.rollback` | W/A/P/C | 回滚到明确的先前版本 |

## 💾 通用数据规则

- 时间使用 RFC 3339 UTC 字符串；同时传递站点原始时区只作展示
- 币种使用 ISO 4217 三字母代码；金额使用整数最小货币单位 `amount_minor`
- ID 是不透明稳定字符串；站点原始 ID 放入明确的 `external_ref`，不得作为跨租户全局 ID
- 列表使用游标分页：请求 `cursor`、`limit`，响应 `items`、`next_cursor`、`has_more`
- 默认最大 `limit` 由能力清单声明；超限返回 `validation`
- 可变资源返回不透明 `version`；写请求使用 `expected_version` 实现乐观并发
- 缺失字段表示“未提供”，显式 `null` 只在字段允许清空时表示“清空”
- 枚举遇到未知值时保留原始值并映射为 `unknown`，不能丢弃整个资源
- 读取快照返回 `observed_at`；基于库存/价格的自动写操作必须检查允许的新鲜度
- 批量操作返回逐项结果，单项失败不掩盖已成功项

## 🛡️ 写入安全

### 幂等

所有写操作必须带 `idempotency_key`。同一 tenant、store、操作名和幂等键：

- 请求规范化内容相同：返回第一次调用的确定结果或同一异步句柄
- 内容不同：返回 `conflict`，不得执行第二次
- 保留期至少覆盖业务最长重试/对账窗口，由能力清单声明
- HTTP/网络超时后控制面复用原键；禁止生成新键“再试一次”

### 乐观并发

更新既有资源时使用 `expected_version`。版本不匹配返回 `conflict` 并提供当前版本引用；控制面必须重新读取、重新计算并重新审批，不能直接覆盖。

### 确认与试运行

高风险动作携带 `approval_id`、批准快照哈希和影响范围。Adapter 验证批准未过期且与请求一致。支持 `dry_run` 的能力先返回影响预览；试运行结果不是执行承诺，正式请求仍需版本校验。

### 补偿信息

成功写入返回 `before_version`、`after_version`、可用的 `compensation_action` 和限制。补偿不是事务回滚保证；无法安全补偿时必须明确标记 `non_compensable`。

## 🔄 异步操作

异步响应至少包含：

```json
{
  "operation_id": "op_01H...",
  "status": "accepted",
  "submitted_at": "2026-09-11T10:00:00Z",
  "poll_after_ms": 2000,
  "resource_ref": null,
  "error": null
}
```

允许状态和转换：

- `accepted` → `running`、`canceled`、`failed`、`expired`
- `running` → `succeeded`、`failed`、`canceled`、`expired`
- `succeeded`、`failed`、`canceled`、`expired` 为终态

`get_operation(operation_id)` 必须幂等。取消请求只表示“请求取消”，Adapter 返回最终是否取消；已经产生的副作用需在结果中说明。终态结果保留期由能力清单声明。

## 📥 事件与 Webhook

### 标准信封

```json
{
  "contract_version": "1.0",
  "event_id": "evt_01H...",
  "event_type": "inventory.level.changed",
  "tenant_id": "tenant_123",
  "store_id": "store_456",
  "resource_ref": {"type": "sku", "id": "sku_789", "version": "v18"},
  "occurred_at": "2026-09-11T10:00:00Z",
  "sent_at": "2026-09-11T10:00:01Z",
  "correlation_id": "corr_abc",
  "sequence": null,
  "data": {}
}
```

### 接收规则

- Connector 使用每个站点独立的签名密钥验证消息体、时间戳和签名
- 超出配置重放窗口或签名无效的请求返回 `unauthorized`
- `event_id` 是去重键；重复事件返回成功 acknowledgement 但不重复触发业务工作流
- 除明确声明的资源序列外，不假设跨资源全局有序
- 先持久化接收和去重事实，再异步处理；2xx 只表示已安全接收
- 处理失败进入重试/死信并保留 `correlation_id`，不要求站点无限重发

## ⚠️ 错误协议

### 标准错误

| `code` | 语义 | 默认重试 |
| --- | --- | --- |
| `unauthorized` | 凭据/签名无效或过期 | 刷新凭据后一次 |
| `forbidden` | actor 或 scope 无权操作 | 否 |
| `not_found` | 目标资源不存在或不可见 | 否 |
| `conflict` | 版本、幂等内容或业务状态冲突 | 重新读取后决定 |
| `rate_limited` | 超出站点限制 | 按 `retry_after_ms` |
| `transient` | 临时网络或服务故障 | 指数退避 |
| `validation` | 请求字段或业务规则无效 | 否 |
| `unsupported` | 能力/模式/版本未实现 | 否 |

错误对象至少包含 `code`、安全的 `message`、`retryable`、`correlation_id`，可选 `retry_after_ms`、`field_errors` 和 `provider_reference`。不得暴露内部堆栈、token、密码或个人敏感信息。

只有 `rate_limited` 和明确标记的 `transient` 默认自动重试；总尝试次数、退避和熔断由控制面限制。401 刷新认证后只允许以同一幂等键重放一次写请求。

## 📊 可靠性与可观察性

- 每个调用设置连接、首字节和总超时；异步操作不靠无限 HTTP 等待
- 控制面按 Adapter/store/capability 维护熔断器和并发限制
- 指标至少包含调用量、延迟、错误码、重试、限流、结果未知和对账次数
- Trace 属性包含契约/Adapter 版本、tenant/store 的不可逆安全标识、能力和关联 ID
- 日志记录参数摘要和敏感字段遮蔽结果，不记录原始凭据
- Adapter 健康由轻量探测和真实能力探针区分；健康不能绕过权限检查
- 结果未知的写操作进入 reconciliation，不得直接标记失败后发起新业务意图

## 🧪 v1 一致性测试

### 所有 Adapter 必测

1. 支持版本与能力清单格式有效
2. 缺失/错误 tenant、store、actor 或 scope 时默认拒绝
3. 游标分页无重复、无跳页且遵守最大页大小
4. 金额最小单位和币种往返一致
5. 相同幂等键与相同请求只产生一次副作用
6. 相同幂等键与不同请求返回 `conflict`
7. `expected_version` 冲突不会覆盖新状态
8. 429 使用标准 `rate_limited` 与重试提示
9. 临时故障映射为 `transient`，业务校验不被误判为可重试
10. 日志、错误、Trace 和审计中无凭据泄漏
11. 异步操作状态只能按允许转换，并能恢复查询终态
12. Webhook 签名、重放窗口、去重和乱序处理符合协议
13. 批量写入返回逐项结果并可安全重试失败项
14. 高风险写入缺少有效审批时拒绝
15. 能力缺失明确返回 `unsupported`

### ZMall 参考 Adapter 矩阵

ZMall 首版至少覆盖 Catalog 读取、Inventory 读取、Pricing 读取、Orders 读取、履约查询和售后提交，并验证：

- 登录/凭据刷新与单次 401 重放
- 429 和网络超时的标准错误映射
- ZMall 元/分字段与 `amount_minor` 的无损转换
- ZMall 分页字段与通用游标的稳定映射
- 商品、订单、物流、FAQ、售后状态的标准化
- 写操作幂等、审批和审计信息不会被 ZMall 专属字段绕过

只有当第二种不同平台或标准独立站 Adapter 也通过核心测试，Store Adapter v1 才能从草案升级为稳定生态协议。
