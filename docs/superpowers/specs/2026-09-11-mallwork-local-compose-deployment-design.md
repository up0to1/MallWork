# MallWork 本机 Docker Compose 部署设计

## 目标

将 `pao-coder66/globex-agent` 作为独立项目保存到
`Cross_Big_Project/MallWork`，并使用 Windows 本机现有的 Docker Desktop
运行仓库提供的完整 Compose 栈。部署必须保留现有 `.env`、运行数据和
Docker 命名卷，不以清库、覆盖配置或删除卷作为排错手段。

首次部署只改变工作目录名称，不批量重命名 Python 包、数据库文件、
Docker 卷或 API 中已有的 `globex` 标识。完成可运行验收后，如需对外品牌
统一，再作为独立变更处理，以免把部署问题和重命名回归混在一起。

## 架构

Docker Compose 在 Docker Desktop 的 Linux 容器环境内运行五个服务：

- `frontend`：React 静态构建产物与 Nginx，同源代理 API，宿主机端口 5173。
- `app`：FastAPI 与网页 AG-UI 主执行路径，宿主机端口 8000。
- `worker`：旧 intents/异步任务的 Redis 消费者，与 `app` 复用应用镜像。
- `redis`：缓存、共享能力和旧任务队列，宿主机端口 6379。
- `qdrant`：商品与知识向量索引，宿主机端口 6333。

业务持久化继续使用项目已验证的 SQLite，不接入 Ubuntu VM 中的 MySQL。
SQLite、Redis 与 Qdrant 分别使用 `app-data`、`redis-data`、`qdrant-data`
命名卷。Ubuntu VM `192.168.59.128` 不进入本次运行链路；这样避免跨主机
网络、服务监听和防火墙差异影响评测复现。

## 配置与数据保护

启动前先检查精确目标目录、端口、Docker Engine 和 Compose 配置。根目录
已有 `.env` 时只读取字段是否存在，不输出密钥，也不覆盖文件；不存在时从
`.env.example` 创建一次本地副本，再由用户补充真实凭据。至少要求有效的
`LLM_API_KEY`，并核对 `LLM_BASE_URL`、`LLM_MODEL`、
`LLM_FALLBACK_MODEL` 和 `EMBEDDING_MODEL`。

默认 embedding 复用 LLM 网关和密钥。只有网关不同才需要
`EMBEDDING_BASE_URL` 与 `EMBEDDING_API_KEY`；由于当前 Compose 未透传这两项，
遇到该情形需先做一个最小 Compose 配置修正并验证展开配置不泄露密钥。
Reranker、Tavily 和 Langfuse 均为可选能力。

不得执行 `docker compose down -v`、删除 `data/`、删除数据库或重建现有卷。
普通停止只使用不带 `-v` 的 `down`。首次克隆仅包含版本化商品目录；运行态
数据由新建的命名卷持久化。

## 启动与数据流

使用根目录 `.env` 通过 `docker compose --env-file .env -f
docker/docker-compose.yaml` 先做静默配置校验，再构建并启动服务。浏览器访问
`http://127.0.0.1:5173`；Nginx 将 `/health` 与 `/commerce/*` 转发至 `app`。
网页请求由 API 进程直接执行，模型调用检索和交易工具；向量请求发往 Qdrant，
会话、偏好、确认和订单写入 SQLite。worker 是否处理旧队列不影响网页主链
的真实选购验收。

## 故障处理

- Docker Engine 未运行：启动 Docker Desktop，确认 Engine 就绪后继续。
- 端口被占用：识别占用进程并报告，不擅自终止用户进程或静默换端口。
- 模型凭据缺失或为占位符：停止在配置门禁，告知需要填写的字段，不打印值。
- 镜像拉取或依赖安装失败：保留构建日志，修复网络或依赖后重试同一构建。
- Redis/Qdrant 不健康：检查 Compose 状态和对应日志，不删除命名卷排错。
- 健康检查通过但页面失败：继续检查模型、embedding、SSE 和浏览器控制台；
  `/health` 不替代真实模型调用验证。

## 验收

1. `docker compose config --quiet` 成功，5173、8000、6333、6379 无冲突。
2. 五个 Compose 服务处于运行状态，Redis 健康，应用日志无启动错误。
3. `GET http://127.0.0.1:8000/health` 返回 HTTP 200 且 `status` 为 `ok`，
   已启用依赖不报错。
4. 浏览器打开 `http://127.0.0.1:5173`，使用固定同源身份发送
   “预算 300 元以内，找一个寄到中国的轻便背包”。
5. 页面收到真实流式回答并出现商品卡；至少打开或选择一个候选商品，确认
   选购交互有效，同时检查对应后端日志未发生模型或检索失败。
6. 最终报告页面、API 与 API 文档地址，以及使用的部署形态、数据卷状态和
   仍缺少的可选模型/观测字段。
