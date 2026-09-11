# Mall Work 兼容品牌改名设计

## 目标

将项目对外品牌从 `Globex` 改为 `Mall Work`，同时保持既有本地数据、浏览器会话和服务间协议兼容。项目目录继续使用 `MallWork`，机器可读的项目 slug 使用 `mallwork`。

## 改名范围

对外可见内容统一使用 `Mall Work`：

- 前端品牌名、页面标题、元描述、无障碍标签、提示文案和页脚；
- FastAPI 对外应用标题；
- README 的项目标题、目录示例和项目说明；
- Python 与 npm 包元数据使用机器可读名称 `mallwork-agent`、`mallwork-frontend`；
- Compose 注释和可观测服务名称使用 `mallwork-api`、`mallwork-worker`。

## 兼容边界

以下内部标识继续保留 `globex`，避免迁移或丢失现有状态：

- SQLite 文件名 `globex.db` 与现有 Docker 数据卷；
- Qdrant 集合 `globex_products`、`globex_category_kb`；
- Redis stream、键前缀、consumer group 与事件频道；
- WebSocket 子协议、JWT issuer/audience/type；
- 浏览器 localStorage 键；
- Prometheus 指标名、OpenTelemetry 属性名；
- Python 模块、提示词文件名、测试夹具、历史评测报告及历史设计记录。

保留这些标识属于兼容实现，不代表对外品牌仍为 Globex。

## 实施与验证

修改仅覆盖当前产品入口和项目元数据，不机械改写历史证据文件。更新锁文件中的本地包名后，执行前端测试与生产构建、后端相关测试、Compose 配置校验和镜像重建。服务重建时不得删除卷或覆盖 `.env`。

最后重新验证：

1. 前后端健康检查成功；
2. 浏览器标题、首页、选购工作区和详情页不再显示旧品牌；
3. 发起一次真实模型选购并打开商品详情；
4. 现有 SQLite、Redis 与 Qdrant 标识和卷仍然可用。

## 回滚

品牌变更为源码层改动，可通过提交回滚；底层数据格式和存储位置不变，因此无需数据回滚。
