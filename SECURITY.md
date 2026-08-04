# Security Policy

## 安全边界声明

Mall Work 是一个基于 pi agent 的电商 AI 工作台产品层封装。本仓库（`packages/mall-skills/`）包含电商平台 API 客户端代码，**不包含**以下敏感信息：

- 服务器凭证、API Key、密钥
- 生产环境服务器 URL 或 IP 地址
- 数据库连接字符串
- 用户数据或业务数据

## 开源暴露信息审计

本仓库公开了以下与电商平台接口相关的信息：

### 低风险（等同于公开 API 文档）

| 暴露项 | 内容 | 风险评估 |
|--------|------|----------|
| API 路径 | `/users/login`、`/search/list`、`/items/{id}`、`/api/v1/outfit/agent/*` | 低 — API 路径公开不构成独立安全风险 |
| 认证流程 | JWT token、`Authorization: Bearer <token>` header | 低 — 标准 JWT 认证，不泄露密钥 |
| 默认配置 | `DEFAULT_GATEWAY_URL = "http://localhost:8080"` | 低 — 开发默认值，非生产 URL |
| 数据结构 | 商品、用户、穿搭相关的请求/响应 JSON 结构 | 低 — 公开 API 文档标准做法 |

### 中风险（已有缓解措施）

| 暴露项 | 内容 | 风险评估 |
|--------|------|----------|
| 凭证存储 | password 明文存储于 `~/.mall-agent/credentials.json`（用于 401 自动重登录） | 中 — 本地文件，不入库，已有注释提示迁移至 refresh token |

### 安全设计

- **网关 URL 外部化**：生产 URL 通过 `ZMALL_GATEWAY_URL` 环境变量注入，源码仅含 localhost 开发默认值
- **凭证文件隔离**：`~/.mall-agent/credentials.json` 在用户主目录，`.mall-agent/` 已在 `.gitignore` 中
- **无硬编码密钥**：源码中无 API Key、密钥、生产 URL（已审计验证）

## 安全性依赖服务端认证

**重要原则**：接口信息公开 ≠ 安全风险。

安全性应依赖服务端认证和防护，而非接口隐蔽（security through obscurity 不可靠）。即使攻击者知道 API 路径和认证流程，在以下服务端防护下无法造成实际危害：

## ZMall 服务端安全加固清单

ZMall 服务器上线前应实施以下安全措施：

### 1. 速率限制（Rate Limiting）
- API 端点：每 IP 每分钟 ≤ 60 次请求
- 登录端点 `/users/login`：每 IP 每分钟 ≤ 5 次请求（防暴力破解）
- 搜索端点 `/search/list`：每 IP 每分钟 ≤ 30 次请求（防爬虫）
- 超限返回 `429 Too Many Requests`，响应 `Retry-After` header

### 2. CORS 配置
- 配置严格的 `Access-Control-Allow-Origin` 白名单，仅允许已知前端域名
- **禁止**使用 `Access-Control-Allow-Origin: *`
- 限制 `Access-Control-Allow-Methods` 为实际需要的方法
- 限制 `Access-Control-Allow-Headers` 为实际需要的 header

### 3. HTTPS 强制
- 全站强制 HTTPS，拒绝所有 HTTP 请求（301 重定向或直接拒绝）
- 配置 HSTS header：`Strict-Transport-Security: max-age=31536000; includeSubDomains`
- 使用 TLS 1.2+，禁用 TLS 1.0/1.1
- 配置有效的 SSL 证书（Let's Encrypt 或商业证书）

### 4. 输入校验
- 所有 API 端点实施输入校验：类型、长度、格式、范围
- 登录端点防范 SQL 注入（参数化查询/ORM）
- 登录端点防范暴力破解：连续失败 5 次锁定 15 分钟
- 搜索端点防范 XSS：对搜索关键词进行 HTML 转义
- 文件上传端点校验文件类型、大小、内容

### 5. 认证加固
- JWT token 过期时间 ≤ 2 小时
- 实现 refresh token 机制（替代 password 明文存储）
- JWT 签名密钥存储在服务端环境变量中，不入库不入日志
- 登录失败不泄露具体原因（统一返回"用户名或密码错误"）
- 敏感操作（修改密码、支付）要求二次验证

### 6. 日志与监控
- 记录所有 API 请求日志（含 IP、时间、端点、状态码）
- 记录登录失败日志，监控异常登录模式
- 配置告警：异常流量、暴力破解、SQL 注入尝试
- 定期审计日志，保留 ≥ 90 天

### 7. 其他 OWASP Top 10 防护
- **注入防护**：参数化查询，ORM 自动转义
- **失效的访问控制**：服务端校验用户角色和权限，不依赖客户端
- **安全配置错误**：关闭默认错误页面、目录列表、不必要的 HTTP 方法
- **敏感数据泄露**：密码 bcrypt 哈希存储，不返回 password 字段
- **XXE 防护**：XML 解析器禁用外部实体

## 漏洞报告

如发现 Mall Work 仓库中的安全问题，请通过以下方式报告：

- GitHub Issues: https://github.com/up0to1/mall-work/issues
- 邮件：通过 GitHub 私密联系仓库 owner

**响应时间**：收到报告后 48 小时内确认，7 个工作日内提供初步评估。

**请勿**在公开 Issue 中披露漏洞详情，请先通过私密渠道联系。

## 致谢

感谢安全社区对开源项目的关注和支持。
