# Integration Patches

本文档记录 Mall Work 对 pi agent 核心代码的产品集成定制修改。这些修改不属于 pi 内部改进，不会推送回 upstream (earendil-works/pi-mono)，仅在本地 `mall/main` 集成分支上维护。

当从 upstream 同步 pi 更新后，需要重新应用以下补丁。

## 1. packages/coding-agent/package.json

**修改类型**：Rebranding（产品定制）

**修改内容**（3 处）：

### 1.1 piConfig 添加 name 字段
```diff
 "piConfig": {
-  "configDir": ".pi"
+  "name": "mall-agent",
+  "configDir": ".mall-agent"
 }
```

### 1.2 bin 字段重命名
```diff
 "bin": {
-  "pi": "dist/cli.js"
+  "mall-agent": "dist/cli.js"
 }
```

**重新应用**：将 piConfig.name 设为 `"mall-agent"`，piConfig.configDir 设为 `".mall-agent"`，bin 的 key 从 `"pi"` 改为 `"mall-agent"`。

## 2. packages/coding-agent/src/extensions/index.ts

**修改类型**：Extension 注册（产品集成）

**修改内容**：
```diff
 import type { InlineExtension } from "../core/extensions/types.ts";
+import mallSkillsExtension from "@mall/skills";
 import llamaExtension from "./llama/index.ts";

-export const builtInExtensions: InlineExtension[] = [{ name: "llama.cpp", factory: llamaExtension, hidden: true }];
+export const builtInExtensions: InlineExtension[] = [
+  { name: "llama.cpp", factory: llamaExtension, hidden: true },
+  { name: "mall-skills", factory: mallSkillsExtension, hidden: false },
+];
```

**重新应用**：添加 `import mallSkillsExtension from "@mall/skills"`，并在 builtInExtensions 数组中添加 `{ name: "mall-skills", factory: mallSkillsExtension, hidden: false }`。

## 3. tsconfig.json

**修改类型**：路径别名（产品集成）

**修改内容**：
```diff
 "@earendil-works/pi-agent-old/*": ["./packages/agent-old/src/*"],
+"@mall/skills": ["./packages/mall-skills/src/index.ts"],
+"@mall/skills/*": ["./packages/mall-skills/src/*"]
```

**重新应用**：在 tsconfig.json 的 `compilerOptions.paths` 中添加 `"@mall/skills"` 和 `"@mall/skills/*"` 两个路径别名。

## Upstream 同步后重新应用步骤

1. 切换到 `main` 分支：`git checkout main`
2. 拉取 upstream 更新：`git fetch upstream && git rebase upstream/main`
3. 推送到 origin（pi-mono fork）：`git push origin main`
4. 切换到 `mall/main` 集成分支：`git checkout mall/main`
5. Rebase 到更新后的 main：`git rebase main`
6. 如果冲突，按上述 3 个补丁重新应用修改
7. 验证构建：`npm run build`
8. 验证运行：`node packages/coding-agent/dist/cli.js --help`

## 分类说明

| 修改 | 类型 | 推送目标 |
|------|------|----------|
| coding-agent/package.json (rebranding) | 产品集成定制 | 仅 mall/main（本地） |
| extensions/index.ts (mall-skills 注册) | 产品集成定制 | 仅 mall/main（本地） |
| tsconfig.json (@mall/skills 别名) | 产品集成定制 | 仅 mall/main（本地） |
| packages/mall-skills/* (全部 skill 代码) | 产品层 | mall-work 仓库 main 分支 |
| packages/ai/scripts/proxy-preload.mjs | 本地辅助脚本 | 不入库（gitignored） |

**注意**：如果未来对 pi agent 内部代码有实质性改进（如 bug fix、性能优化、新功能），这类修改应在 `main` 分支上开发，推送到 `origin/main`（pi-mono fork），并向 upstream 发起 Pull Request。
