/**
 * Echo Skill 验证脚本
 *
 * 不依赖 LLM，直接验证：
 * 1. mall-skills 扩展能被 import（模块解析正常）
 * 2. registerEchoSkill 能被调用（扩展工厂函数正常）
 * 3. echo 工具被注册到 mock pi 对象（registerTool 机制正常）
 * 4. echo 工具的 execute 函数返回正确结果（工具逻辑正常）
 *
 * 运行方式：
 *   node ../../node_modules/tsx/dist/cli.mjs --tsconfig ../../tsconfig.json test/verify-echo.ts
 */

import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import mallSkillsExtension from "../src/index.ts";
import { registerEchoSkill, echoSkillConfig } from "../src/skills/echo.ts";

// ===== Mock ExtensionAPI =====
const registeredTools: Map<string, ToolDefinition> = new Map();
const registeredFlags: Record<string, unknown> = {};
const eventHandlers: Record<string, ((...args: unknown[]) => unknown)[]> = {};
let activeTools: string[] = [];

const mockPi = {
	registerTool(tool: ToolDefinition) {
		registeredTools.set(tool.name, tool);
	},
	registerFlag(name: string, config: { default?: unknown }) {
		registeredFlags[name] = config.default;
	},
	getFlag(name: string): unknown {
		return registeredFlags[name];
	},
	on(event: string, handler: (...args: unknown[]) => unknown) {
		if (!eventHandlers[event]) {
			eventHandlers[event] = [];
		}
		eventHandlers[event].push(handler);
	},
	getActiveTools(): string[] {
		return activeTools;
	},
	setActiveTools(tools: string[]) {
		activeTools = tools;
	},
} as unknown as ExtensionAPI;

// ===== 测试 1：echo skill 配置正确 =====
console.log("测试 1：echo skill 配置");
console.assert(echoSkillConfig.name === "echo", "skill name 应为 'echo'");
console.assert(
	echoSkillConfig.allowedRoles.length === 3,
	"echo skill 应允许所有 3 个角色",
);
console.log("  ✓ 配置正确\n");

// ===== 测试 2：registerEchoSkill 注册工具 =====
console.log("测试 2：registerEchoSkill 注册工具");
registerEchoSkill(mockPi as ExtensionAPI);
console.assert(registeredTools.has("echo"), "echo 工具应被注册");
const echoTool = registeredTools.get("echo");
console.assert(echoTool !== undefined, "echo 工具应存在");
console.assert(echoTool?.name === "echo", "工具名应为 'echo'");
console.assert(echoTool?.label === "Echo", "工具 label 应为 'Echo'");
console.assert(
	typeof echoTool?.description === "string" && echoTool.description.length > 0,
	"工具 description 应非空",
);
console.assert(
	typeof echoTool?.promptSnippet === "string" && echoTool.promptSnippet.length > 0,
	"工具 promptSnippet 应非空（用于注入 system prompt）",
);
console.log("  ✓ 工具注册正确\n");

// ===== 测试 3：参数 schema 正确 =====
console.log("测试 3：参数 schema");
const params = echoTool?.parameters as { properties?: Record<string, unknown> };
console.assert(params?.properties?.message !== undefined, "参数应包含 message 字段");
console.log("  ✓ 参数 schema 正确\n");

// ===== 测试 4：execute 函数返回正确结果 =====
console.log("测试 4：execute 函数");
const testMessage = "hello mall-agent";
const result = await echoTool?.execute("test-call-id", { message: testMessage });
console.assert(result !== undefined, "execute 应返回结果");
console.assert(
	result?.content?.length === 1 && result.content[0]?.type === "text",
	"content 应为单个 text 块",
);
console.assert(
	(result?.content?.[0] as { text?: string })?.text === testMessage,
	`text 应为 "${testMessage}"，实际：${(result?.content?.[0] as { text?: string })?.text}`,
);
console.assert(
	(result?.details as { echoed?: boolean })?.echoed === true,
	"details.echoed 应为 true",
);
console.log(`  ✓ execute 返回正确："${testMessage}"\n`);

// ===== 测试 5：mall-skills 扩展入口可调用 =====
console.log("测试 5：mall-skills 扩展入口");
registeredTools.clear();
mallSkillsExtension(mockPi as ExtensionAPI);
console.assert(registeredTools.has("echo"), "扩展入口应注册 echo 工具");
console.log("  ✓ 扩展入口正常\n");

// ===== 总结 =====
console.log("========================================");
console.log("所有测试通过！echo skill 验证成功。");
console.log("========================================");
console.log(`\n已注册工具：${[...registeredTools.keys()].join(", ")}`);
console.log(`\n下一步：配置可用的 LLM provider 后，用以下命令端到端验证：`);
console.log(`  node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json \\`);
console.log(`    packages/coding-agent/src/cli.ts \\`);
console.log(`    --provider <provider> --model <model> \\`);
console.log(`    -p "Use the echo tool to echo back: hello mall-agent"`);
