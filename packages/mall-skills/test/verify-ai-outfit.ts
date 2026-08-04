/**
 * AI Outfit Skill 验证脚本
 *
 * 不依赖 LLM，也不依赖运行中的 ai-outfit 服务，直接验证：
 *   1. aiOutfitSkillConfig 配置结构（allowedRoles = ["customer", "admin"], 2 个工具）
 *   2. 角色权限：customer 放行，merchant 被拦截，admin 放行
 *   3. 工具注册（mock pi 对象，验证 2 个工具被正确注册）
 *   4. query_outfit 参数校验（无输入参数时返回错误）
 *   5. regenerate_outfit 参数校验（缺 taskId / feedback 时返回错误）
 *   6. 工具描述与 promptSnippet 非空
 *   7. pollOutfitResult 逻辑（mock fetchResult 模拟 PROCESSING → SUCCESS）
 *   8. pollOutfitResult 超时逻辑（持续 PROCESSING → 返回 PROCESSING）
 *   9. pollOutfitResult FAILED 逻辑
 *
 * 运行方式（从 monorepo 根目录）：
 *   D:\nvm\v22.19.0\node.exe node_modules\tsx\dist\cli.mjs --tsconfig tsconfig.json \
 *     packages\mall-skills\test\verify-ai-outfit.ts
 */

import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { buildToolPermissionMap, isToolAllowed } from "../src/index.ts";
import {
	registerAiOutfitSkill,
	aiOutfitSkillConfig,
	callOutfitApi,
	pollOutfitResult,
} from "../src/skills/ai-outfit.ts";

// ===== 简易测试框架 =====
let passCount = 0;
let failCount = 0;

function check(label: string, condition: boolean, detail?: string): void {
	if (condition) {
		passCount++;
		console.log(`  \u2713 ${label}`);
	} else {
		failCount++;
		console.error(`  \u2717 ${label}${detail ? ` —— ${detail}` : ""}`);
	}
}

function section(title: string): void {
	console.log(`\n===== ${title} =====`);
}

// ===== Mock ExtensionAPI =====
const registeredTools: Map<string, ToolDefinition> = new Map();

const mockPi: Pick<ExtensionAPI, "registerTool"> = {
	registerTool(tool: ToolDefinition) {
		registeredTools.set(tool.name, tool);
	},
};

// ===== 测试 1：aiOutfitSkillConfig 配置结构 =====
section("测试 1：aiOutfitSkillConfig 配置结构");

check(
	'skill name === "ai-outfit"',
	aiOutfitSkillConfig.name === "ai-outfit",
	`实际：${aiOutfitSkillConfig.name}`,
);
check(
	"allowedRoles 包含 2 个角色",
	aiOutfitSkillConfig.allowedRoles.length === 2,
	`实际长度：${aiOutfitSkillConfig.allowedRoles.length}`,
);
check(
	'allowedRoles 包含 "customer"',
	aiOutfitSkillConfig.allowedRoles.includes("customer"),
);
check(
	'allowedRoles 包含 "admin"',
	aiOutfitSkillConfig.allowedRoles.includes("admin"),
);
check(
	'allowedRoles 不包含 "merchant"',
	!aiOutfitSkillConfig.allowedRoles.includes("merchant"),
	`实际：${JSON.stringify(aiOutfitSkillConfig.allowedRoles)}`,
);
check(
	"toolNames 包含 2 个工具",
	aiOutfitSkillConfig.toolNames.length === 2,
	`实际长度：${aiOutfitSkillConfig.toolNames.length}`,
);
check(
	'toolNames 包含 "query_outfit"',
	aiOutfitSkillConfig.toolNames.includes("query_outfit"),
);
check(
	'toolNames 包含 "regenerate_outfit"',
	aiOutfitSkillConfig.toolNames.includes("regenerate_outfit"),
);

// ===== 测试 2：角色权限 - customer 放行 =====
section("测试 2：角色权限 - customer 放行");

const permissionMap = buildToolPermissionMap();

const aiOutfitToolNames = ["query_outfit", "regenerate_outfit"];

for (const toolName of aiOutfitToolNames) {
	check(
		`权限映射包含 ${toolName}`,
		permissionMap.has(toolName),
	);
}

for (const toolName of aiOutfitToolNames) {
	check(
		`customer 允许使用 ${toolName}`,
		isToolAllowed(toolName, "customer", permissionMap) === true,
		`实际：${isToolAllowed(toolName, "customer", permissionMap)}`,
	);
}

// ===== 测试 3：角色权限 - merchant 被拦截 =====
section("测试 3：角色权限 - merchant 被拦截");

for (const toolName of aiOutfitToolNames) {
	check(
		`merchant 被拦截使用 ${toolName}`,
		isToolAllowed(toolName, "merchant", permissionMap) === false,
		`实际：${isToolAllowed(toolName, "merchant", permissionMap)}`,
	);
}

// ===== 测试 4：角色权限 - admin 放行 =====
section("测试 4：角色权限 - admin 放行");

for (const toolName of aiOutfitToolNames) {
	check(
		`admin 允许使用 ${toolName}`,
		isToolAllowed(toolName, "admin", permissionMap) === true,
		`实际：${isToolAllowed(toolName, "admin", permissionMap)}`,
	);
}

// ===== 测试 5：工具注册（mock pi 对象）=====
section("测试 5：工具注册（mock pi 对象）");

registerAiOutfitSkill(mockPi as ExtensionAPI);

check(
	"注册了 2 个工具",
	registeredTools.size === 2,
	`实际数量：${registeredTools.size}`,
);
check(
	"query_outfit 工具已注册",
	registeredTools.has("query_outfit"),
);
check(
	"regenerate_outfit 工具已注册",
	registeredTools.has("regenerate_outfit"),
);

// ===== 测试 6：query_outfit 工具结构 =====
section("测试 6：query_outfit 工具结构");

const queryOutfitTool = registeredTools.get("query_outfit");
check("query_outfit 工具存在", queryOutfitTool !== undefined);
check(
	'query_outfit label === "Query Outfit"',
	queryOutfitTool?.label === "Query Outfit",
	`实际：${queryOutfitTool?.label}`,
);
check(
	"query_outfit description 非空",
	typeof queryOutfitTool?.description === "string" && queryOutfitTool.description.length > 0,
);
check(
	"query_outfit promptSnippet 非空",
	typeof queryOutfitTool?.promptSnippet === "string" && queryOutfitTool.promptSnippet.length > 0,
);
check(
	"query_outfit promptSnippet 包含风格提示",
	typeof queryOutfitTool?.promptSnippet === "string" && queryOutfitTool.promptSnippet.includes("通勤"),
);
check(
	"query_outfit promptSnippet 包含颜色提示",
	typeof queryOutfitTool?.promptSnippet === "string" && queryOutfitTool.promptSnippet.includes("白色"),
);

const queryParams = queryOutfitTool?.parameters as { properties?: Record<string, unknown> };
check(
	"query_outfit 参数包含 styleTags",
	queryParams?.properties?.styleTags !== undefined,
);
check(
	"query_outfit 参数包含 colors",
	queryParams?.properties?.colors !== undefined,
);
check(
	"query_outfit 参数包含 sceneDesc",
	queryParams?.properties?.sceneDesc !== undefined,
);
check(
	"query_outfit 参数包含 note",
	queryParams?.properties?.note !== undefined,
);
check(
	"query_outfit 参数包含 gender",
	queryParams?.properties?.gender !== undefined,
);
check(
	"query_outfit 参数包含 city",
	queryParams?.properties?.city !== undefined,
);

// ===== 测试 7：regenerate_outfit 工具结构 =====
section("测试 7：regenerate_outfit 工具结构");

const regenerateTool = registeredTools.get("regenerate_outfit");
check("regenerate_outfit 工具存在", regenerateTool !== undefined);
check(
	'regenerate_outfit label === "Regenerate Outfit"',
	regenerateTool?.label === "Regenerate Outfit",
	`实际：${regenerateTool?.label}`,
);
check(
	"regenerate_outfit description 非空",
	typeof regenerateTool?.description === "string" && regenerateTool.description.length > 0,
);
check(
	"regenerate_outfit promptSnippet 非空",
	typeof regenerateTool?.promptSnippet === "string" && regenerateTool.promptSnippet.length > 0,
);
check(
	"regenerate_outfit promptSnippet 包含 taskId 提示",
	typeof regenerateTool?.promptSnippet === "string" && regenerateTool.promptSnippet.includes("taskId"),
);

const regenParams = regenerateTool?.parameters as { properties?: Record<string, unknown> };
check(
	"regenerate_outfit 参数包含 taskId",
	regenParams?.properties?.taskId !== undefined,
);
check(
	"regenerate_outfit 参数包含 feedback",
	regenParams?.properties?.feedback !== undefined,
);
check(
	"regenerate_outfit 参数包含 outfitIndex",
	regenParams?.properties?.outfitIndex !== undefined,
);
check(
	"regenerate_outfit 参数包含 itemIndex",
	regenParams?.properties?.itemIndex !== undefined,
);
check(
	"regenerate_outfit 参数包含 dislikeColors",
	regenParams?.properties?.dislikeColors !== undefined,
);
check(
	"regenerate_outfit 参数包含 wantStyleTags",
	regenParams?.properties?.wantStyleTags !== undefined,
);

// ===== 测试 8：query_outfit execute - 无参数校验 =====
section("测试 8：query_outfit execute - 无参数校验");

if (queryOutfitTool) {
	const execResult = await queryOutfitTool.execute(
		"test-call-id",
		{},
		undefined,
		undefined,
		{} as never,
	);

	check(
		"无参数时返回 content 数组",
		Array.isArray(execResult.content) && execResult.content.length > 0,
	);
	check(
		"无参数时返回错误提示文本",
		typeof execResult.content[0]?.text === "string" &&
			execResult.content[0].text.includes("至少"),
		`实际：${execResult.content[0]?.text}`,
	);
	check(
		"无参数时 details.status === VALIDATION_ERROR",
		(execResult.details as { status?: string }).status === "VALIDATION_ERROR",
		`实际：${(execResult.details as { status?: string }).status}`,
	);
}

// ===== 测试 9：query_outfit execute - 空数组参数校验 =====
section("测试 9：query_outfit execute - 空数组参数校验");

if (queryOutfitTool) {
	const execResult = await queryOutfitTool.execute(
		"test-call-id",
		{ styleTags: [], colors: [], sceneDesc: "", note: "" },
		undefined,
		undefined,
		{} as never,
	);

	check(
		"空数组/空字符串参数时返回错误提示",
		typeof execResult.content[0]?.text === "string" &&
			execResult.content[0].text.includes("至少"),
		`实际：${execResult.content[0]?.text}`,
	);
	check(
		"空数组参数时 details.status === VALIDATION_ERROR",
		(execResult.details as { status?: string }).status === "VALIDATION_ERROR",
	);
}

// ===== 测试 10：regenerate_outfit execute - 缺 taskId 校验 =====
section("测试 10：regenerate_outfit execute - 缺 taskId 校验");

if (regenerateTool) {
	const execResult = await regenerateTool.execute(
		"test-call-id",
		{ feedback: "换一套" },
		undefined,
		undefined,
		{} as never,
	);

	check(
		"缺 taskId 时返回错误提示",
		typeof execResult.content[0]?.text === "string" &&
			execResult.content[0].text.includes("taskId"),
		`实际：${execResult.content[0]?.text}`,
	);
	check(
		"缺 taskId 时 details.status === VALIDATION_ERROR",
		(execResult.details as { status?: string }).status === "VALIDATION_ERROR",
	);
}

// ===== 测试 11：regenerate_outfit execute - 缺 feedback 校验 =====
section("测试 11：regenerate_outfit execute - 缺 feedback 校验");

if (regenerateTool) {
	const execResult = await regenerateTool.execute(
		"test-call-id",
		{ taskId: "test-task-id" },
		undefined,
		undefined,
		{} as never,
	);

	check(
		"缺 feedback 时返回错误提示",
		typeof execResult.content[0]?.text === "string" &&
			execResult.content[0].text.includes("feedback"),
		`实际：${execResult.content[0]?.text}`,
	);
	check(
		"缺 feedback 时 details.status === VALIDATION_ERROR",
		(execResult.details as { status?: string }).status === "VALIDATION_ERROR",
	);
}

// ===== 测试 12：regenerate_outfit execute - feedback 过长校验 =====
section("测试 12：regenerate_outfit execute - feedback 过长校验");

if (regenerateTool) {
	const longFeedback = "a".repeat(201);
	const execResult = await regenerateTool.execute(
		"test-call-id",
		{ taskId: "test-task-id", feedback: longFeedback },
		undefined,
		undefined,
		{} as never,
	);

	check(
		"feedback 过长时返回错误提示",
		typeof execResult.content[0]?.text === "string" &&
			execResult.content[0].text.includes("过长"),
		`实际：${execResult.content[0]?.text}`,
	);
	check(
		"feedback 过长时 details.status === VALIDATION_ERROR",
		(execResult.details as { status?: string }).status === "VALIDATION_ERROR",
	);
}

// ===== 测试 13：regenerate_outfit execute - outfitIndex 超范围校验 =====
section("测试 13：regenerate_outfit execute - outfitIndex 超范围校验");

if (regenerateTool) {
	const execResult = await regenerateTool.execute(
		"test-call-id",
		{ taskId: "test-task-id", feedback: "换一套", outfitIndex: 5 },
		undefined,
		undefined,
		{} as never,
	);

	check(
		"outfitIndex 超范围时返回错误提示",
		typeof execResult.content[0]?.text === "string" &&
			execResult.content[0].text.includes("outfitIndex"),
		`实际：${execResult.content[0]?.text}`,
	);
	check(
		"outfitIndex 超范围时 details.status === VALIDATION_ERROR",
		(execResult.details as { status?: string }).status === "VALIDATION_ERROR",
	);
}

// ===== 测试 14：工具 execute 函数存在 =====
section("测试 14：工具 execute 函数存在");

for (const toolName of aiOutfitToolNames) {
	const tool = registeredTools.get(toolName);
	check(
		`${toolName} 有 execute 函数`,
		typeof tool?.execute === "function",
	);
}

// ===== 测试 15：callOutfitApi 是可调用函数 =====
section("测试 15：callOutfitApi 是可调用函数");

check(
	"callOutfitApi 是函数",
	typeof callOutfitApi === "function",
);
check(
	"pollOutfitResult 是函数",
	typeof pollOutfitResult === "function",
);

// ===== 测试 16：pollOutfitResult - PROCESSING → SUCCESS =====
section("测试 16：pollOutfitResult - PROCESSING → SUCCESS");

{
	let callCount = 0;
	const mockFetchResult = async (_taskId: string): Promise<{
		status: "PROCESSING" | "SUCCESS" | "FAILED";
		taskId: string;
		outfits?: unknown[];
	}> => {
		callCount++;
		if (callCount < 3) {
			return { status: "PROCESSING", taskId: _taskId };
		}
		return {
			status: "SUCCESS",
			taskId: _taskId,
			outfits: [
				{
					items: [
						{
							itemId: 12345,
							name: "白色T恤",
							image: "https://example.com/tshirt.jpg",
							category: "上衣",
							color: "白色",
							price: 99.0,
							shopName: "店铺A",
							styleTags: ["通勤"],
						},
					],
					resultUrl: "https://example.com/vton.jpg",
					reason: "推荐理由",
					score: 0.92,
				},
			],
		};
	};

	const result = await pollOutfitResult("task-123", 10, 0, mockFetchResult);

	check(
		"pollOutfitResult 返回 status === SUCCESS",
		result.status === "SUCCESS",
		`实际：${result.status}`,
	);
	check(
		"pollOutfitResult 返回正确 taskId",
		result.taskId === "task-123",
		`实际：${result.taskId}`,
	);
	check(
		"pollOutfitResult 调用了 3 次 fetchResult（2 次 PROCESSING + 1 次 SUCCESS）",
		callCount === 3,
		`实际调用次数：${callCount}`,
	);
	check(
		"pollOutfitResult 返回 outfits 数组",
		Array.isArray(result.outfits) && result.outfits.length === 1,
		`实际：${JSON.stringify(result.outfits?.length)}`,
	);
	check(
		"pollOutfitResult outfits[0].items[0].name === 白色T恤",
		result.outfits?.[0]?.items?.[0]?.name === "白色T恤",
	);
}

// ===== 测试 17：pollOutfitResult - 首次即 SUCCESS =====
section("测试 17：pollOutfitResult - 首次即 SUCCESS");

{
	let callCount = 0;
	const mockFetchResult = async (_taskId: string): Promise<{
		status: "PROCESSING" | "SUCCESS" | "FAILED";
		taskId: string;
	}> => {
		callCount++;
		return { status: "SUCCESS", taskId: _taskId };
	};

	const result = await pollOutfitResult("task-immediate", 10, 0, mockFetchResult);

	check(
		"首次即 SUCCESS → status === SUCCESS",
		result.status === "SUCCESS",
		`实际：${result.status}`,
	);
	check(
		"首次即 SUCCESS → 只调用 1 次",
		callCount === 1,
		`实际调用次数：${callCount}`,
	);
}

// ===== 测试 18：pollOutfitResult - 持续 PROCESSING → 超时 =====
section("测试 18：pollOutfitResult - 持续 PROCESSING → 超时");

{
	let callCount = 0;
	const mockFetchResult = async (_taskId: string): Promise<{
		status: "PROCESSING" | "SUCCESS" | "FAILED";
		taskId: string;
	}> => {
		callCount++;
		return { status: "PROCESSING", taskId: _taskId };
	};

	const maxAttempts = 5;
	const result = await pollOutfitResult("task-timeout", maxAttempts, 0, mockFetchResult);

	check(
		"持续 PROCESSING → 超时返回 status === PROCESSING",
		result.status === "PROCESSING",
		`实际：${result.status}`,
	);
	check(
		`持续 PROCESSING → 调用次数 === ${maxAttempts}`,
		callCount === maxAttempts,
		`实际调用次数：${callCount}`,
	);
	check(
		"超时返回 taskId 正确",
		result.taskId === "task-timeout",
		`实际：${result.taskId}`,
	);
}

// ===== 测试 19：pollOutfitResult - FAILED =====
section("测试 19：pollOutfitResult - FAILED");

{
	let callCount = 0;
	const mockFetchResult = async (_taskId: string): Promise<{
		status: "PROCESSING" | "SUCCESS" | "FAILED";
		taskId: string;
		errorMsg?: string;
	}> => {
		callCount++;
		if (callCount === 1) {
			return { status: "PROCESSING", taskId: _taskId };
		}
		return { status: "FAILED", taskId: _taskId, errorMsg: "生成失败：素材不足" };
	};

	const result = await pollOutfitResult("task-failed", 10, 0, mockFetchResult);

	check(
		"FAILED → status === FAILED",
		result.status === "FAILED",
		`实际：${result.status}`,
	);
	check(
		"FAILED → errorMsg 正确",
		result.errorMsg === "生成失败：素材不足",
		`实际：${result.errorMsg}`,
	);
	check(
		"FAILED → 调用 2 次（1 次 PROCESSING + 1 次 FAILED）",
		callCount === 2,
		`实际调用次数：${callCount}`,
	);
}

// ===== 测试 20：pollOutfitResult - 正确传递 taskId 给 fetchResult =====
section("测试 20：pollOutfitResult - 正确传递 taskId 给 fetchResult");

{
	let receivedTaskId = "";
	const mockFetchResult = async (tid: string): Promise<{
		status: "PROCESSING" | "SUCCESS" | "FAILED";
		taskId: string;
	}> => {
		receivedTaskId = tid;
		return { status: "SUCCESS", taskId: tid };
	};

	await pollOutfitResult("task-pass-through", 5, 0, mockFetchResult);

	check(
		"fetchResult 收到正确的 taskId",
		receivedTaskId === "task-pass-through",
		`实际：${receivedTaskId}`,
	);
}

// ===== 测试 21：ai-outfit 已加入角色权限映射 =====
section("测试 21：ai-outfit 已加入角色权限映射");

check(
	"权限映射包含 query_outfit",
	permissionMap.has("query_outfit"),
);
check(
	"权限映射包含 regenerate_outfit",
	permissionMap.has("regenerate_outfit"),
);
check(
	'query_outfit allowedRoles = ["customer","admin"]',
	JSON.stringify(permissionMap.get("query_outfit")) === JSON.stringify(["customer", "admin"]),
	`实际：${JSON.stringify(permissionMap.get("query_outfit"))}`,
);
check(
	'regenerate_outfit allowedRoles = ["customer","admin"]',
	JSON.stringify(permissionMap.get("regenerate_outfit")) === JSON.stringify(["customer", "admin"]),
	`实际：${JSON.stringify(permissionMap.get("regenerate_outfit"))}`,
);

// ===== 总结 =====
console.log("\n========================================");
console.log(`通过：${passCount}  失败：${failCount}`);
console.log("========================================");
if (failCount > 0) {
	console.error("\n\u274C AI Outfit Skill 验证失败，请检查上方失败项。");
	process.exit(1);
} else {
	console.log("\n\u2705 所有测试通过！Task 7 AI Outfit Skill 验证成功。");
	console.log(`\n已注册工具：${[...registeredTools.keys()].join(", ")}`);
	console.log(`\n角色权限：${JSON.stringify(aiOutfitSkillConfig.allowedRoles)}`);
	console.log(`\n下一步：启动 ZMall 后端 + ai-outfit 服务后，用以下命令端到端验证：`);
	console.log(`  D:\\nvm\\v22.19.0\\node.exe node_modules\\tsx\\dist\\cli.mjs \\`);
	console.log(`    --tsconfig tsconfig.json \\`);
	console.log(`    packages\\coding-agent\\src\\cli.ts \\`);
	console.log(`    --provider <provider> --model <model> --role customer \\`);
	console.log(`    -p "帮我搭配一套通勤风格的衣服，偏好白色和蓝色"`);
}
