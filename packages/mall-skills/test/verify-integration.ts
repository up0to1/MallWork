/**
 * Task 9: End-to-End Integration Tests for Mall Skills
 *
 * 验证整个 skill 系统的端到端集成。这不是单个 skill 的单元测试，
 * 而是测试跨模块协作和完整工作流。
 *
 * 测试策略：
 *   - 使用 mock pi 对象加载整个 mallSkillsExtension
 *   - 通过 emit 模拟 session_start / tool_call / before_agent_start 事件
 *   - 对 HTTP 依赖的工具（query_outfit / regenerate_outfit），mock global.fetch
 *   - 对确定性 mock 数据的工具（fetch_market_trend 等），直接调用 execute
 *
 * 测试组：
 *   1. Full Extension Loading — 验证 12 个工具 + 1 个 flag + 3 个事件处理器全部注册
 *   2. Customer Role Workflow — session_start 过滤 + tool_call 拦截 + before_agent_start 注入
 *   3. Merchant Role Workflow
 *   4. Admin Role Workflow
 *   5. Cross-Skill: Customer Outfit Consultation — query_outfit → regenerate_outfit 全链路
 *   6. Cross-Skill: Merchant Product Research — fetch_market_trend → analyze_competitors → generate_selection_report
 *   7. Permission Boundary Tests — tool_call 拦截器阻止越权调用
 *   8. Invalid Role Handling — 非法角色回退 customer
 *
 * 运行方式（从 monorepo 根目录）：
 *   D:\nvm\v22.19.0\node.exe node_modules\tsx\dist\cli.mjs --tsconfig tsconfig.json \
 *     packages\mall-skills\test\verify-integration.ts
 */

import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import mallSkillsExtension, { resolveRole } from "../src/index.ts";
import { DEFAULT_ROLE } from "../src/types.ts";
import { pollOutfitResult } from "../src/skills/ai-outfit.ts";

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

// ===== 所有 12 个工具名 =====

const ALL_TOOL_NAMES = [
	"echo",
	"test_customer_only",
	"test_merchant_only",
	"zmall_login",
	"query_items",
	"query_item_detail",
	"query_outfit",
	"regenerate_outfit",
	"fetch_market_trend",
	"analyze_competitors",
	"query_zmall_items",
	"generate_selection_report",
] as const;

// ===== Mock ExtensionAPI =====

interface MockFlagOptions {
	description?: string;
	type: "boolean" | "string";
	default?: boolean | string;
}

function createMockPi() {
	const tools = new Map<string, ToolDefinition>();
	const flags = new Map<string, { options: MockFlagOptions; value: boolean | string | undefined }>();
	const handlers = new Map<string, Array<(event?: unknown, ctx?: unknown) => unknown>>();
	let activeTools: string[] = [];

	const mock = {
		// 暴露内部状态供测试检查
		tools,
		flags,
		handlers,
		// 注册方法
		registerTool(tool: ToolDefinition): void {
			tools.set(tool.name, tool);
		},
		registerFlag(name: string, options: MockFlagOptions): void {
			flags.set(name, { options, value: options.default });
		},
		getFlag(name: string): boolean | string | undefined {
			return flags.get(name)?.value;
		},
		on(event: string, handler: (event?: unknown, ctx?: unknown) => unknown): void {
			if (!handlers.has(event)) {
				handlers.set(event, []);
			}
			handlers.get(event)!.push(handler);
		},
		getActiveTools(): string[] {
			return [...activeTools];
		},
		setActiveTools(toolNames: string[]): void {
			activeTools = [...toolNames];
		},

		// 测试辅助方法
		setFlagValue(name: string, value: boolean | string): void {
			const flag = flags.get(name);
			if (flag) {
				flag.value = value;
			}
		},
		emit(event: string, ...args: unknown[]): unknown {
			const eventHandlers = handlers.get(event) ?? [];
			let result: unknown;
			for (const h of eventHandlers) {
				const r = h(...args);
				if (r !== undefined) {
					result = r;
				}
			}
			return result;
		},
		hasHandler(event: string): boolean {
			return (handlers.get(event)?.length ?? 0) > 0;
		},
		getHandlerCount(event: string): number {
			return handlers.get(event)?.length ?? 0;
		},
	};

	return mock;
}

type MockPi = ReturnType<typeof createMockPi>;

// ===== Mock Fetch 工厂（用于 HTTP 依赖的工具）=====

interface MockFetchConfig {
	/** POST /api/v1/outfit/agent/recommend 的响应 */
	recommendResponse?: { taskId: string; status: string };
	/** POST /api/v1/outfit/agent/feedback 的响应 */
	feedbackResponse?: { taskId: string; status: string };
	/** GET /api/v1/outfit/agent/result/{taskId} 的响应 */
	resultResponse?: unknown;
	/** GET /search/list 的响应（query_zmall_items / query_items） */
	searchListResponse?: unknown;
	/** GET /items/{id} 的响应（query_item_detail） */
	itemDetailResponse?: unknown;
	/** POST /users/login 的响应（zmall_login） */
	loginResponse?: unknown;
}

function createMockFetch(config: MockFetchConfig) {
	let callLog: { url: string; method: string }[] = [];

	const mockFetch = async (
		input: string | URL | Request,
		init?: RequestInit,
	): Promise<{
		ok: boolean;
		status: number;
		json: () => Promise<unknown>;
	}> => {
		const url = typeof input === "string" ? input : input.toString();
		const method = init?.method ?? "GET";
		callLog.push({ url, method });

		// POST /api/v1/outfit/agent/recommend
		if (url.includes("/api/v1/outfit/agent/recommend") && method === "POST") {
			return {
				ok: true,
				status: 200,
				json: async () =>
					config.recommendResponse ?? { taskId: "task-outfit-001", status: "PROCESSING" },
			};
		}

		// POST /api/v1/outfit/agent/feedback
		if (url.includes("/api/v1/outfit/agent/feedback") && method === "POST") {
			return {
				ok: true,
				status: 200,
				json: async () =>
					config.feedbackResponse ?? { taskId: "task-outfit-002", status: "PROCESSING" },
			};
		}

		// GET /api/v1/outfit/agent/result/{taskId}
		if (url.includes("/api/v1/outfit/agent/result/") && method === "GET") {
			return {
				ok: true,
				status: 200,
				json: async () =>
					config.resultResponse ?? {
						status: "SUCCESS",
						taskId: "task-outfit-001",
						outfits: [
							{
								items: [
									{
										itemId: 1001,
										name: "白色衬衫",
										image: "https://example.com/shirt.jpg",
										category: "上衣",
										color: "白色",
										price: 129.0,
										shopName: "时尚旗舰店",
										styleTags: ["通勤"],
									},
									{
										itemId: 1002,
										name: "黑色西裤",
										image: "https://example.com/pants.jpg",
										category: "裤子",
										color: "黑色",
										price: 199.0,
										shopName: "商务精选",
										styleTags: ["通勤"],
									},
								],
								resultUrl: "https://example.com/vton-result.jpg",
								reason: "经典通勤搭配，白衬衫配黑西裤，简约大方",
								score: 0.92,
							},
						],
					},
			};
		}

		// GET /search/list (query_items / query_zmall_items)
		if (url.includes("/search/list") && method === "GET") {
			return {
				ok: true,
				status: 200,
				json: async () =>
					config.searchListResponse ?? {
						total: 2,
						pages: 1,
						list: [
							{
								id: 1,
								name: "测试商品A",
								price: 9900,
								image: "https://example.com/a.jpg",
								category: "上衣",
								sold: 100,
								stock: 50,
							},
							{
								id: 2,
								name: "测试商品B",
								price: 19900,
								image: "https://example.com/b.jpg",
								category: "裤子",
								sold: 200,
								stock: 30,
							},
						],
					},
			};
		}

		// GET /items/{id}
		if (url.match(/\/items\/\d+/) && method === "GET") {
			return {
				ok: true,
				status: 200,
				json: async () =>
					config.itemDetailResponse ?? {
						id: 1,
						name: "测试商品A",
						price: 9900,
						image: "https://example.com/a.jpg",
						category: "上衣",
					},
			};
		}

		// POST /users/login
		if (url.includes("/users/login") && method === "POST") {
			return {
				ok: true,
				status: 200,
				json: async () =>
					config.loginResponse ?? {
						token: "mock-jwt-token",
						userId: 1,
						username: "testuser",
						role: 1,
						balance: 1000,
						phone: "13800000000",
					},
			};
		}

		// 默认：404
		return {
			ok: false,
			status: 404,
			json: async () => null,
		};
	};

	return {
		fetch: mockFetch as typeof fetch,
		getCallLog: () => callLog,
	};
}

// ===== 辅助：设置角色并触发 session_start =====

function setupRole(mockPi: MockPi, role: string, initialTools: string[] = [...ALL_TOOL_NAMES]): void {
	mockPi.setFlagValue("role", role);
	mockPi.setActiveTools(initialTools);
	mockPi.emit("session_start", { type: "session_start", reason: "startup" });
}

// ===== 辅助：触发 tool_call 事件 =====

function emitToolCall(mockPi: MockPi, toolName: string): { block?: boolean; reason?: string } | undefined {
	const result = mockPi.emit("tool_call", {
		type: "tool_call",
		toolCallId: `test-call-${toolName}`,
		toolName,
		input: {},
	});
	return result as { block?: boolean; reason?: string } | undefined;
}

// ===== 加载扩展 =====

const mockPi = createMockPi();
mallSkillsExtension(mockPi as unknown as ExtensionAPI);

// ================================================================
// 测试组 1：Full Extension Loading
// ================================================================

section("测试组 1：Full Extension Loading — 验证全部注册");

check(
	"注册了 12 个工具",
	mockPi.tools.size === 12,
	`实际数量：${mockPi.tools.size}`,
);

for (const toolName of ALL_TOOL_NAMES) {
	check(
		`工具 "${toolName}" 已注册`,
		mockPi.tools.has(toolName),
	);
}

check(
	'--role flag 已注册',
	mockPi.flags.has("role"),
);

check(
	'--role flag 默认值为 "customer"',
	mockPi.getFlag("role") === DEFAULT_ROLE,
	`实际：${mockPi.getFlag("role")}`,
);

check(
	'--role flag 类型为 string',
	mockPi.flags.get("role")?.options.type === "string",
);

check(
	'--role flag description 非空',
	typeof mockPi.flags.get("role")?.options.description === "string" &&
		mockPi.flags.get("role")!.options.description.length > 0,
);

check(
	'session_start 事件处理器已注册',
	mockPi.hasHandler("session_start"),
);

check(
	'tool_call 事件处理器已注册',
	mockPi.hasHandler("tool_call"),
);

check(
	'before_agent_start 事件处理器已注册',
	mockPi.hasHandler("before_agent_start"),
);

check(
	'每个事件处理器只注册了 1 个',
	mockPi.getHandlerCount("session_start") === 1 &&
		mockPi.getHandlerCount("tool_call") === 1 &&
		mockPi.getHandlerCount("before_agent_start") === 1,
);

// 验证所有工具都有 execute 函数
for (const toolName of ALL_TOOL_NAMES) {
	const tool = mockPi.tools.get(toolName);
	check(
		`工具 "${toolName}" 有 execute 函数`,
		typeof tool?.execute === "function",
	);
}

// ================================================================
// 测试组 2：Customer Role Workflow
// ================================================================

section("测试组 2：Customer Role Workflow");

// 2.1 session_start 过滤工具
setupRole(mockPi, "customer");

const customerActiveTools = mockPi.getActiveTools();

const customerAllowedTools = [
	"echo",
	"test_customer_only",
	"zmall_login",
	"query_items",
	"query_item_detail",
	"query_outfit",
	"regenerate_outfit",
];

const customerBlockedTools = [
	"test_merchant_only",
	"fetch_market_trend",
	"analyze_competitors",
	"query_zmall_items",
	"generate_selection_report",
];

check(
	"customer 过滤后剩余 7 个工具",
	customerActiveTools.length === 7,
	`实际：${customerActiveTools.length}，工具列表：${customerActiveTools.join(", ")}`,
);

for (const toolName of customerAllowedTools) {
	check(
		`customer: ${toolName} 可用`,
		customerActiveTools.includes(toolName),
	);
}

for (const toolName of customerBlockedTools) {
	check(
		`customer: ${toolName} 被禁用`,
		!customerActiveTools.includes(toolName),
	);
}

// 2.2 tool_call 拦截器 — 允许的工具放行
{
	const result = emitToolCall(mockPi, "echo");
	check(
		"customer tool_call echo → 放行（无 block）",
		result === undefined || result?.block !== true,
		`实际：${JSON.stringify(result)}`,
	);
}

{
	const result = emitToolCall(mockPi, "query_outfit");
	check(
		"customer tool_call query_outfit → 放行",
		result === undefined || result?.block !== true,
	);
}

// 2.3 tool_call 拦截器 — 禁止的工具被拦截
{
	const result = emitToolCall(mockPi, "fetch_market_trend");
	check(
		"customer tool_call fetch_market_trend → 被拦截",
		result?.block === true,
		`实际：${JSON.stringify(result)}`,
	);
	check(
		"customer tool_call fetch_market_trend → reason 包含角色名",
		typeof result?.reason === "string" && result.reason.includes("customer"),
		`实际：${result?.reason}`,
	);
	check(
		"customer tool_call fetch_market_trend → reason 包含工具名",
		typeof result?.reason === "string" && result.reason.includes("fetch_market_trend"),
		`实际：${result?.reason}`,
	);
}

// 2.4 before_agent_start 注入角色上下文
{
	const result = mockPi.emit("before_agent_start", {
		type: "before_agent_start",
		prompt: "帮我搭配一套衣服",
		systemPrompt: "",
	}) as { message?: { customType?: string; content?: string; display?: boolean } } | undefined;

	check(
		"customer before_agent_start 返回 message",
		result?.message !== undefined,
		`实际：${JSON.stringify(result)}`,
	);
	check(
		"customer before_agent_start message.customType === 'mall-role-context'",
		result?.message?.customType === "mall-role-context",
		`实际：${result?.message?.customType}`,
	);
	check(
		"customer before_agent_start message.content 包含 'CUSTOMER'",
		typeof result?.message?.content === "string" && result.message.content.includes("CUSTOMER"),
		`实际：${result?.message?.content?.substring(0, 50)}`,
	);
	check(
		"customer before_agent_start message.content 包含 'customer' 角色描述",
		typeof result?.message?.content === "string" && result.message.content.includes("customer"),
	);
	check(
		"customer before_agent_start message.display === false",
		result?.message?.display === false,
		`实际：${result?.message?.display}`,
	);
}

// ================================================================
// 测试组 3：Merchant Role Workflow
// ================================================================

section("测试组 3：Merchant Role Workflow");

setupRole(mockPi, "merchant");

const merchantActiveTools = mockPi.getActiveTools();

const merchantAllowedTools = [
	"echo",
	"test_merchant_only",
	"zmall_login",
	"query_items",
	"query_item_detail",
	"fetch_market_trend",
	"analyze_competitors",
	"query_zmall_items",
	"generate_selection_report",
];

const merchantBlockedTools = [
	"test_customer_only",
	"query_outfit",
	"regenerate_outfit",
];

check(
	"merchant 过滤后剩余 9 个工具",
	merchantActiveTools.length === 9,
	`实际：${merchantActiveTools.length}，工具列表：${merchantActiveTools.join(", ")}`,
);

for (const toolName of merchantAllowedTools) {
	check(
		`merchant: ${toolName} 可用`,
		merchantActiveTools.includes(toolName),
	);
}

for (const toolName of merchantBlockedTools) {
	check(
		`merchant: ${toolName} 被禁用`,
		!merchantActiveTools.includes(toolName),
	);
}

// tool_call 拦截器
{
	const result = emitToolCall(mockPi, "fetch_market_trend");
	check(
		"merchant tool_call fetch_market_trend → 放行",
		result === undefined || result?.block !== true,
	);
}

{
	const result = emitToolCall(mockPi, "query_outfit");
	check(
		"merchant tool_call query_outfit → 被拦截",
		result?.block === true,
		`实际：${JSON.stringify(result)}`,
	);
	check(
		"merchant tool_call query_outfit → reason 包含 'merchant'",
		typeof result?.reason === "string" && result.reason.includes("merchant"),
		`实际：${result?.reason}`,
	);
}

// before_agent_start 注入 merchant 角色上下文
{
	const result = mockPi.emit("before_agent_start", {
		type: "before_agent_start",
		prompt: "帮我分析竞品",
		systemPrompt: "",
	}) as { message?: { content?: string } } | undefined;

	check(
		"merchant before_agent_start message.content 包含 'MERCHANT'",
		typeof result?.message?.content === "string" && result.message.content.includes("MERCHANT"),
		`实际：${result?.message?.content?.substring(0, 50)}`,
	);
}

// ================================================================
// 测试组 4：Admin Role Workflow
// ================================================================

section("测试组 4：Admin Role Workflow");

setupRole(mockPi, "admin");

const adminActiveTools = mockPi.getActiveTools();

const adminAllowedTools = [
	"echo",
	"zmall_login",
	"query_items",
	"query_item_detail",
	"query_outfit",
	"regenerate_outfit",
	"fetch_market_trend",
	"analyze_competitors",
	"query_zmall_items",
	"generate_selection_report",
];

const adminBlockedTools = [
	"test_customer_only",
	"test_merchant_only",
];

check(
	"admin 过滤后剩余 10 个工具",
	adminActiveTools.length === 10,
	`实际：${adminActiveTools.length}，工具列表：${adminActiveTools.join(", ")}`,
);

for (const toolName of adminAllowedTools) {
	check(
		`admin: ${toolName} 可用`,
		adminActiveTools.includes(toolName),
	);
}

for (const toolName of adminBlockedTools) {
	check(
		`admin: ${toolName} 被禁用`,
		!adminActiveTools.includes(toolName),
	);
}

// admin 可以同时访问 ai-outfit 和 product-research
{
	const outfitResult = emitToolCall(mockPi, "query_outfit");
	check(
		"admin tool_call query_outfit → 放行（admin 在 ai-outfit allowedRoles 中）",
		outfitResult === undefined || outfitResult?.block !== true,
		`实际：${JSON.stringify(outfitResult)}`,
	);
}

{
	const researchResult = emitToolCall(mockPi, "fetch_market_trend");
	check(
		"admin tool_call fetch_market_trend → 放行（admin 在 product-research allowedRoles 中）",
		researchResult === undefined || researchResult?.block !== true,
	);
}

{
	const customerOnlyResult = emitToolCall(mockPi, "test_customer_only");
	check(
		"admin tool_call test_customer_only → 被拦截（admin 不在 allowedRoles 中）",
		customerOnlyResult?.block === true,
		`实际：${JSON.stringify(customerOnlyResult)}`,
	);
}

// before_agent_start 注入 admin 角色上下文
{
	const result = mockPi.emit("before_agent_start", {
		type: "before_agent_start",
		prompt: "管理后台",
		systemPrompt: "",
	}) as { message?: { content?: string } } | undefined;

	check(
		"admin before_agent_start message.content 包含 'ADMIN'",
		typeof result?.message?.content === "string" && result.message.content.includes("ADMIN"),
		`实际：${result?.message?.content?.substring(0, 50)}`,
	);
}

// ================================================================
// 测试组 5：Cross-Skill Workflow — Customer Outfit Consultation
// ================================================================

section("测试组 5：Cross-Skill Workflow — Customer Outfit Consultation");

// 切换回 customer 角色
setupRole(mockPi, "customer");

const queryOutfitTool = mockPi.tools.get("query_outfit");
const regenerateOutfitTool = mockPi.tools.get("regenerate_outfit");

check("query_outfit 工具存在", queryOutfitTool !== undefined);
check("regenerate_outfit 工具存在", regenerateOutfitTool !== undefined);

// 5.1 query_outfit 参数校验 — 无参数
{
	const result = await queryOutfitTool!.execute(
		"test-call-1",
		{},
		undefined,
		undefined,
		{} as never,
	);

	check(
		"query_outfit 无参数 → 返回 content 数组",
		Array.isArray(result.content) && result.content.length > 0,
	);
	check(
		"query_outfit 无参数 → details.status === VALIDATION_ERROR",
		(result.details as { status?: string }).status === "VALIDATION_ERROR",
		`实际：${(result.details as { status?: string }).status}`,
	);
}

// 5.2 query_outfit 全链路 — 使用 mock fetch
{
	const originalFetch = globalThis.fetch;
	const mockFetchHelper = createMockFetch({
		recommendResponse: { taskId: "task-outfit-001", status: "PROCESSING" },
		resultResponse: {
			status: "SUCCESS",
			taskId: "task-outfit-001",
			outfits: [
				{
					items: [
						{
							itemId: 1001,
							name: "白色衬衫",
							image: "https://example.com/shirt.jpg",
							category: "上衣",
							color: "白色",
							price: 129.0,
							shopName: "时尚旗舰店",
							styleTags: ["通勤"],
						},
						{
							itemId: 1002,
							name: "黑色西裤",
							image: "https://example.com/pants.jpg",
							category: "裤子",
							color: "黑色",
							price: 199.0,
							shopName: "商务精选",
							styleTags: ["通勤"],
						},
					],
					resultUrl: "https://example.com/vton-result.jpg",
					reason: "经典通勤搭配，白衬衫配黑西裤，简约大方",
					score: 0.92,
				},
			],
		},
	});

	globalThis.fetch = mockFetchHelper.fetch;

	try {
		const result = await queryOutfitTool!.execute(
			"test-call-2",
			{ styleTags: ["通勤"], sceneDesc: "秋季通勤" },
			undefined,
			undefined,
			{} as never,
		);

		const details = result.details as {
			taskId?: string;
			status?: string;
			outfits?: Array<{
				items: Array<{ name: string; price: number }>;
				resultUrl: string;
				reason: string;
				score: number;
			}>;
			message?: string;
		};

		check(
			"query_outfit 全链路 → details.status === SUCCESS",
			details.status === "SUCCESS",
			`实际：${details.status}，完整 details：${JSON.stringify(details).substring(0, 200)}`,
		);
		check(
			"query_outfit 全链路 → details.taskId === 'task-outfit-001'",
			details.taskId === "task-outfit-001",
			`实际：${details.taskId}`,
		);
		check(
			"query_outfit 全链路 → outfits 数组非空",
			Array.isArray(details.outfits) && details.outfits.length > 0,
			`实际：${JSON.stringify(details.outfits?.length)}`,
		);
		check(
			"query_outfit 全链路 → outfits[0].items 有 2 个单品",
			details.outfits?.[0]?.items?.length === 2,
			`实际：${details.outfits?.[0]?.items?.length}`,
		);
		check(
			"query_outfit 全链路 → outfits[0].items[0].name === '白色衬衫'",
			details.outfits?.[0]?.items?.[0]?.name === "白色衬衫",
			`实际：${details.outfits?.[0]?.items?.[0]?.name}`,
		);
		check(
			"query_outfit 全链路 → content 文本包含 '搭配方案已生成'",
			typeof result.content[0]?.text === "string" && result.content[0].text.includes("搭配方案已生成"),
			`实际：${result.content[0]?.text?.substring(0, 50)}`,
		);
		check(
			"query_outfit 全链路 → fetch 被调用（recommend + result 轮询）",
			mockFetchHelper.getCallLog().length >= 2,
			`实际调用次数：${mockFetchHelper.getCallLog().length}`,
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
}

// 5.3 regenerate_outfit 参数校验 — 缺 taskId
{
	const result = await regenerateOutfitTool!.execute(
		"test-call-3",
		{ feedback: "换一套" },
		undefined,
		undefined,
		{} as never,
	);

	check(
		"regenerate_outfit 缺 taskId → details.status === VALIDATION_ERROR",
		(result.details as { status?: string }).status === "VALIDATION_ERROR",
		`实际：${(result.details as { status?: string }).status}`,
	);
}

// 5.4 regenerate_outfit 全链路 — 使用 mock fetch
{
	const originalFetch = globalThis.fetch;
	const mockFetchHelper = createMockFetch({
		feedbackResponse: { taskId: "task-outfit-002", status: "PROCESSING" },
		resultResponse: {
			status: "SUCCESS",
			taskId: "task-outfit-002",
			outfits: [
				{
					items: [
						{
							itemId: 2001,
							name: "蓝色针织衫",
							image: "https://example.com/knit.jpg",
							category: "上衣",
							color: "蓝色",
							price: 159.0,
							shopName: "潮流前线",
							styleTags: ["休闲"],
						},
					],
					resultUrl: "https://example.com/vton-result-2.jpg",
					reason: "换一套后的休闲搭配",
					score: 0.88,
				},
			],
		},
	});

	globalThis.fetch = mockFetchHelper.fetch;

	try {
		const result = await regenerateOutfitTool!.execute(
			"test-call-4",
			{ taskId: "task-outfit-001", feedback: "换一套" },
			undefined,
			undefined,
			{} as never,
		);

		const details = result.details as {
			taskId?: string;
			status?: string;
			outfits?: Array<{
				items: Array<{ name: string }>;
			}>;
		};

		check(
			"regenerate_outfit 全链路 → details.status === SUCCESS",
			details.status === "SUCCESS",
			`实际：${details.status}`,
		);
		check(
			"regenerate_outfit 全链路 → details.taskId === 'task-outfit-002'",
			details.taskId === "task-outfit-002",
			`实际：${details.taskId}`,
		);
		check(
			"regenerate_outfit 全链路 → outfits 非空",
			Array.isArray(details.outfits) && details.outfits.length > 0,
		);
		check(
			"regenerate_outfit 全链路 → outfits[0].items[0].name === '蓝色针织衫'",
			details.outfits?.[0]?.items?.[0]?.name === "蓝色针织衫",
			`实际：${details.outfits?.[0]?.items?.[0]?.name}`,
		);
		check(
			"regenerate_outfit 全链路 → content 文本包含 '搭配方案已调整'",
			typeof result.content[0]?.text === "string" && result.content[0].text.includes("搭配方案已调整"),
			`实际：${result.content[0]?.text?.substring(0, 50)}`,
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
}

// 5.5 pollOutfitResult 异步轮询逻辑 — PROCESSING → SUCCESS
{
	let callCount = 0;
	const mockFetchResult = async (tid: string): Promise<{
		status: "PROCESSING" | "SUCCESS" | "FAILED";
		taskId: string;
		outfits?: unknown[];
	}> => {
		callCount++;
		if (callCount < 3) {
			return { status: "PROCESSING", taskId: tid };
		}
		return {
			status: "SUCCESS",
			taskId: tid,
			outfits: [{ items: [], resultUrl: "", reason: "", score: 0.9 }],
		};
	};

	const result = await pollOutfitResult("task-poll-test", 10, 0, mockFetchResult);

	check(
		"pollOutfitResult PROCESSING→SUCCESS → status === SUCCESS",
		result.status === "SUCCESS",
		`实际：${result.status}`,
	);
	check(
		"pollOutfitResult 调用了 3 次（2 次 PROCESSING + 1 次 SUCCESS）",
		callCount === 3,
		`实际：${callCount}`,
	);
}

// ================================================================
// 测试组 6：Cross-Skill Workflow — Merchant Product Research
// ================================================================

section("测试组 6：Cross-Skill Workflow — Merchant Product Research");

// 切换到 merchant 角色
setupRole(mockPi, "merchant");

const fetchMarketTrendTool = mockPi.tools.get("fetch_market_trend");
const analyzeCompetitorsTool = mockPi.tools.get("analyze_competitors");
const generateSelectionReportTool = mockPi.tools.get("generate_selection_report");
const queryZmallItemsTool = mockPi.tools.get("query_zmall_items");

check("fetch_market_trend 工具存在", fetchMarketTrendTool !== undefined);
check("analyze_competitors 工具存在", analyzeCompetitorsTool !== undefined);
check("generate_selection_report 工具存在", generateSelectionReportTool !== undefined);

// 6.1 fetch_market_trend — 确定性 mock 数据，无需 HTTP
let marketTrendDetails: Record<string, unknown>;

{
	const result = await fetchMarketTrendTool!.execute(
		"test-call-5",
		{ category: "女装连衣裙" },
		undefined,
		undefined,
		{} as never,
	);

	marketTrendDetails = result.details as Record<string, unknown>;

	check(
		"fetch_market_trend → content 非空",
		Array.isArray(result.content) && result.content.length > 0,
	);
	check(
		"fetch_market_trend → content 文本包含品类名",
		typeof result.content[0]?.text === "string" && result.content[0].text.includes("女装连衣裙"),
		`实际：${result.content[0]?.text?.substring(0, 80)}`,
	);
	check(
		"fetch_market_trend → details.category === '女装连衣裙'",
		marketTrendDetails.category === "女装连衣裙",
		`实际：${marketTrendDetails.category}`,
	);
	check(
		"fetch_market_trend → details.trendScore 是数字",
		typeof marketTrendDetails.trendScore === "number",
		`实际：${JSON.stringify(marketTrendDetails.trendScore)}`,
	);
	check(
		"fetch_market_trend → details.trendScore 在 40-100 范围",
		typeof marketTrendDetails.trendScore === "number" &&
			(marketTrendDetails.trendScore as number) >= 40 &&
			(marketTrendDetails.trendScore as number) <= 100,
		`实际：${marketTrendDetails.trendScore}`,
	);
	check(
		"fetch_market_trend → details.demandLevel 是 high/medium/low 之一",
		["high", "medium", "low"].includes(marketTrendDetails.demandLevel as string),
		`实际：${marketTrendDetails.demandLevel}`,
	);
	check(
		"fetch_market_trend → details.priceRange 有 min 和 max",
		typeof (marketTrendDetails.priceRange as { min?: number; max?: number })?.min === "number" &&
			typeof (marketTrendDetails.priceRange as { min?: number; max?: number })?.max === "number",
		`实际：${JSON.stringify(marketTrendDetails.priceRange)}`,
	);
	check(
		"fetch_market_trend → details.trendingKeywords 是数组",
		Array.isArray(marketTrendDetails.trendingKeywords),
		`实际：${JSON.stringify(marketTrendDetails.trendingKeywords)}`,
	);
	check(
		"fetch_market_trend → details.topProducts 有 10 个",
		Array.isArray(marketTrendDetails.topProducts) && marketTrendDetails.topProducts.length === 10,
		`实际：${JSON.stringify(marketTrendDetails.topProducts?.length)}`,
	);
	check(
		"fetch_market_trend → details.dataSource 包含 'mock'",
		typeof marketTrendDetails.dataSource === "string" &&
			(marketTrendDetails.dataSource as string).includes("mock"),
		`实际：${marketTrendDetails.dataSource}`,
	);
}

// 6.2 analyze_competitors — 传入 marketTrend 数据
let competitorDetails: Record<string, unknown>;

{
	const result = await analyzeCompetitorsTool!.execute(
		"test-call-6",
		{
			category: "女装连衣裙",
			marketData: marketTrendDetails,
		},
		undefined,
		undefined,
		{} as never,
	);

	competitorDetails = result.details as Record<string, unknown>;

	check(
		"analyze_competitors → content 文本包含品类名",
		typeof result.content[0]?.text === "string" && result.content[0].text.includes("女装连衣裙"),
		`实际：${result.content[0]?.text?.substring(0, 80)}`,
	);
	check(
		"analyze_competitors → details.competitorCount 是数字",
		typeof competitorDetails.competitorCount === "number",
		`实际：${competitorDetails.competitorCount}`,
	);
	check(
		"analyze_competitors → details.averagePrice 是数字",
		typeof competitorDetails.averagePrice === "number",
		`实际：${competitorDetails.averagePrice}`,
	);
	check(
		"analyze_competitors → details.priceDistribution 有 budget/midRange/premium",
		typeof (competitorDetails.priceDistribution as { budget?: number })?.budget === "number" &&
			typeof (competitorDetails.priceDistribution as { midRange?: number })?.midRange === "number" &&
			typeof (competitorDetails.priceDistribution as { premium?: number })?.premium === "number",
		`实际：${JSON.stringify(competitorDetails.priceDistribution)}`,
	);
	check(
		"analyze_competitors → details.commonSellingPoints 是数组",
		Array.isArray(competitorDetails.commonSellingPoints),
		`实际：${JSON.stringify(competitorDetails.commonSellingPoints)}`,
	);
	check(
		"analyze_competitors → details.commonWeaknesses 是数组",
		Array.isArray(competitorDetails.commonWeaknesses),
		`实际：${JSON.stringify(competitorDetails.commonWeaknesses)}`,
	);
	check(
		"analyze_competitors → details.marketSaturation 是 low/medium/high 之一",
		["low", "medium", "high"].includes(competitorDetails.marketSaturation as string),
		`实际：${competitorDetails.marketSaturation}`,
	);
	check(
		"analyze_competitors → details.analysis 是非空字符串",
		typeof competitorDetails.analysis === "string" && (competitorDetails.analysis as string).length > 0,
	);
}

// 6.3 query_zmall_items — 使用 mock fetch 查询库存
{
	const originalFetch = globalThis.fetch;
	const mockFetchHelper = createMockFetch({
		searchListResponse: {
			total: 2,
			pages: 1,
			list: [
				{
					id: 1,
					name: "库存商品A",
					price: 9900,
					image: "https://example.com/a.jpg",
					category: "女装连衣裙",
					sold: 100,
					stock: 50,
				},
				{
					id: 2,
					name: "库存商品B",
					price: 19900,
					image: "https://example.com/b.jpg",
					category: "女装连衣裙",
					sold: 200,
					stock: 30,
				},
			],
		},
	});

	globalThis.fetch = mockFetchHelper.fetch;

	try {
		const result = await queryZmallItemsTool!.execute(
			"test-call-7",
			{ category: "女装连衣裙" },
			undefined,
			undefined,
			{} as never,
		);

		const details = result.details as {
			total?: number;
			items?: Array<{ id: number; name: string; price: number; stock: number }>;
			error?: string;
		};

		check(
			"query_zmall_items → content 非空",
			Array.isArray(result.content) && result.content.length > 0,
		);
		check(
			"query_zmall_items → details.total === 2",
			details.total === 2,
			`实际：${details.total}`,
		);
		check(
			"query_zmall_items → details.items 有 2 个",
			Array.isArray(details.items) && details.items.length === 2,
			`实际：${details.items?.length}`,
		);
		check(
			"query_zmall_items → details.items[0].name === '库存商品A'",
			details.items?.[0]?.name === "库存商品A",
			`实际：${details.items?.[0]?.name}`,
		);
		check(
			"query_zmall_items → price 已从分转为元（9900分 → 99元）",
			details.items?.[0]?.price === 99,
			`实际：${details.items?.[0]?.price}`,
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
}

// 6.4 generate_selection_report — 汇总生成 Markdown 报告
{
	const result = await generateSelectionReportTool!.execute(
		"test-call-8",
		{
			category: "女装连衣裙",
			marketTrend: marketTrendDetails,
			competitorAnalysis: competitorDetails,
		},
		undefined,
		undefined,
		{} as never,
	);

	const details = result.details as {
		report?: string;
		summary?: string;
		generatedAt?: string;
	};

	check(
		"generate_selection_report → content[0].text 是完整报告",
		typeof result.content[0]?.text === "string" && result.content[0].text.length > 100,
		`实际长度：${result.content[0]?.text?.length}`,
	);
	check(
		"generate_selection_report → details.report 非空",
		typeof details.report === "string" && details.report.length > 0,
	);
	check(
		"generate_selection_report → details.summary 非空",
		typeof details.summary === "string" && details.summary.length > 0,
		`实际：${details.summary}`,
	);
	check(
		"generate_selection_report → details.generatedAt 是 ISO 时间字符串",
		typeof details.generatedAt === "string" && details.generatedAt.includes("T"),
		`实际：${details.generatedAt}`,
	);

	// 验证报告包含预期章节
	const reportText = (details.report ?? "") as string;
	check(
		"报告包含 '选品研究报告' 标题",
		reportText.includes("选品研究报告"),
	);
	check(
		"报告包含 '一、趋势概览' 章节",
		reportText.includes("一、趋势概览"),
	);
	check(
		"报告包含 '二、Top 10 爆品清单' 章节",
		reportText.includes("二、Top 10 爆品清单"),
	);
	check(
		"报告包含 '三、竞品价格区间' 章节",
		reportText.includes("三、竞品价格区间"),
	);
	check(
		"报告包含 '四、选品建议' 章节",
		reportText.includes("四、选品建议"),
	);
	check(
		"报告包含品类名 '女装连衣裙'",
		reportText.includes("女装连衣裙"),
	);
	check(
		"报告包含趋势评分",
		reportText.includes("趋势评分"),
	);
	check(
		"报告包含 Markdown 表格语法",
		reportText.includes("|"),
	);
	check(
		"报告 summary 包含趋势评分",
		typeof details.summary === "string" && details.summary.includes("趋势评分"),
		`实际：${details.summary}`,
	);
}

// 6.5 generate_selection_report — 缺必填参数校验
{
	const result = await generateSelectionReportTool!.execute(
		"test-call-9",
		{ category: "测试品类" },
		undefined,
		undefined,
		{} as never,
	);

	const details = result.details as { error?: string };

	check(
		"generate_selection_report 缺参数 → details.error 存在",
		typeof details.error === "string",
		`实际：${details.error}`,
	);
	check(
		"generate_selection_report 缺参数 → content 文本包含 '失败'",
		typeof result.content[0]?.text === "string" && result.content[0].text.includes("失败"),
		`实际：${result.content[0]?.text}`,
	);
}

// ================================================================
// 测试组 7：Permission Boundary Tests
// ================================================================

section("测试组 7：Permission Boundary Tests — tool_call 拦截器");

// 7.1 Customer 越权调用 merchant 工具
setupRole(mockPi, "customer");

{
	const result = emitToolCall(mockPi, "fetch_market_trend");
	check(
		"Boundary: customer → fetch_market_trend 被拦截",
		result?.block === true,
		`实际：${JSON.stringify(result)}`,
	);
}

{
	const result = emitToolCall(mockPi, "generate_selection_report");
	check(
		"Boundary: customer → generate_selection_report 被拦截",
		result?.block === true,
	);
}

{
	const result = emitToolCall(mockPi, "analyze_competitors");
	check(
		"Boundary: customer → analyze_competitors 被拦截",
		result?.block === true,
	);
}

{
	const result = emitToolCall(mockPi, "query_zmall_items");
	check(
		"Boundary: customer → query_zmall_items 被拦截",
		result?.block === true,
	);
}

{
	const result = emitToolCall(mockPi, "test_merchant_only");
	check(
		"Boundary: customer → test_merchant_only 被拦截",
		result?.block === true,
	);
}

// 7.2 Merchant 越权调用 customer 工具
setupRole(mockPi, "merchant");

{
	const result = emitToolCall(mockPi, "query_outfit");
	check(
		"Boundary: merchant → query_outfit 被拦截",
		result?.block === true,
	);
}

{
	const result = emitToolCall(mockPi, "regenerate_outfit");
	check(
		"Boundary: merchant → regenerate_outfit 被拦截",
		result?.block === true,
	);
}

{
	const result = emitToolCall(mockPi, "test_customer_only");
	check(
		"Boundary: merchant → test_customer_only 被拦截",
		result?.block === true,
	);
}

// 7.3 Admin 越权调用 test-only 工具
setupRole(mockPi, "admin");

{
	const result = emitToolCall(mockPi, "test_customer_only");
	check(
		"Boundary: admin → test_customer_only 被拦截",
		result?.block === true,
	);
}

{
	const result = emitToolCall(mockPi, "test_merchant_only");
	check(
		"Boundary: admin → test_merchant_only 被拦截",
		result?.block === true,
	);
}

// 7.4 验证 block reason 消息格式
{
	setupRole(mockPi, "customer");
	const result = emitToolCall(mockPi, "fetch_market_trend");
	check(
		"Block reason 包含 'not allowed to use tool'",
		typeof result?.reason === "string" && result.reason.includes("not allowed to use tool"),
		`实际：${result?.reason}`,
	);
	check(
		"Block reason 包含 'restricted to other roles'",
		typeof result?.reason === "string" && result.reason.includes("restricted to other roles"),
		`实际：${result?.reason}`,
	);
}

// 7.5 非 mall-skills 工具默认放行（default open）
{
	setupRole(mockPi, "customer");

	const nonMallTools = ["bash", "read", "edit", "write", "grep", "find", "ls"];
	for (const toolName of nonMallTools) {
		const result = emitToolCall(mockPi, toolName);
		check(
			`非 mall-skills 工具 "${toolName}" 默认放行`,
			result === undefined || result?.block !== true,
			`实际：${JSON.stringify(result)}`,
		);
	}
}

// 7.6 允许的调用不被拦截（正确放行）
{
	setupRole(mockPi, "customer");
	const allowedResult = emitToolCall(mockPi, "echo");
	check(
		"customer → echo 放行",
		allowedResult === undefined || allowedResult?.block !== true,
	);
}

{
	setupRole(mockPi, "merchant");
	const allowedResult = emitToolCall(mockPi, "fetch_market_trend");
	check(
		"merchant → fetch_market_trend 放行",
		allowedResult === undefined || allowedResult?.block !== true,
	);
}

{
	setupRole(mockPi, "admin");
	const allowedResult = emitToolCall(mockPi, "query_outfit");
	check(
		"admin → query_outfit 放行",
		allowedResult === undefined || allowedResult?.block !== true,
	);
}

// ================================================================
// 测试组 8：Invalid Role Handling
// ================================================================

section("测试组 8：Invalid Role Handling — 非法角色回退 customer");

// 8.1 resolveRole 直接验证
check(
	'resolveRole("superuser") === DEFAULT_ROLE (customer)',
	resolveRole("superuser") === DEFAULT_ROLE,
	`实际：${resolveRole("superuser")}`,
);

check(
	'resolveRole("") === DEFAULT_ROLE (customer)',
	resolveRole("") === DEFAULT_ROLE,
	`实际：${resolveRole("")}`,
);

check(
	"resolveRole(undefined) === DEFAULT_ROLE (customer)",
	resolveRole(undefined) === DEFAULT_ROLE,
	`实际：${resolveRole(undefined)}`,
);

check(
	"resolveRole(true) === DEFAULT_ROLE (非字符串)",
	resolveRole(true) === DEFAULT_ROLE,
	`实际：${resolveRole(true)}`,
);

check(
	"resolveRole(false) === DEFAULT_ROLE (非字符串)",
	resolveRole(false) === DEFAULT_ROLE,
	`实际：${resolveRole(false)}`,
);

check(
	'resolveRole("Customer") === DEFAULT_ROLE (大小写敏感)',
	resolveRole("Customer") === DEFAULT_ROLE,
	`实际：${resolveRole("Customer")}`,
);

// 8.2 session_start 回退 — superuser
{
	setupRole(mockPi, "superuser");
	const activeTools = mockPi.getActiveTools();

	check(
		"--role superuser → 回退 customer → test_customer_only 可用",
		activeTools.includes("test_customer_only"),
		`实际工具列表：${activeTools.join(", ")}`,
	);
	check(
		"--role superuser → 回退 customer → test_merchant_only 被禁",
		!activeTools.includes("test_merchant_only"),
	);
	check(
		"--role superuser → 回退 customer → query_outfit 可用",
		activeTools.includes("query_outfit"),
	);
	check(
		"--role superuser → 回退 customer → fetch_market_trend 被禁",
		!activeTools.includes("fetch_market_trend"),
	);
	check(
		"--role superuser → 回退 customer → 工具数量为 7（customer 集合）",
		activeTools.length === 7,
		`实际：${activeTools.length}`,
	);
}

// 8.3 session_start 回退 — 空字符串
{
	setupRole(mockPi, "");
	const activeTools = mockPi.getActiveTools();

	check(
		'--role "" → 回退 customer → test_customer_only 可用',
		activeTools.includes("test_customer_only"),
	);
	check(
		'--role "" → 回退 customer → 工具数量为 7',
		activeTools.length === 7,
		`实际：${activeTools.length}`,
	);
}

// 8.4 session_start 回退 — undefined（未设置 flag）
{
	// 模拟 flag 未设置的情况：临时删除 flag 值
	mockPi.flags.get("role")!.value = undefined;
	mockPi.setActiveTools([...ALL_TOOL_NAMES]);
	mockPi.emit("session_start", { type: "session_start", reason: "startup" });
	const activeTools = mockPi.getActiveTools();

	check(
		"--role undefined → 回退 customer → test_customer_only 可用",
		activeTools.includes("test_customer_only"),
	);
	check(
		"--role undefined → 回退 customer → test_merchant_only 被禁",
		!activeTools.includes("test_merchant_only"),
	);
	check(
		"--role undefined → 回退 customer → 工具数量为 7",
		activeTools.length === 7,
		`实际：${activeTools.length}`,
	);
}

// 8.5 非法角色 → before_agent_start 注入的是 customer 上下文
{
	setupRole(mockPi, "superuser");
	const result = mockPi.emit("before_agent_start", {
		type: "before_agent_start",
		prompt: "test",
		systemPrompt: "",
	}) as { message?: { content?: string } } | undefined;

	check(
		"非法角色 before_agent_start → 注入 CUSTOMER 上下文",
		typeof result?.message?.content === "string" && result.message.content.includes("CUSTOMER"),
		`实际：${result?.message?.content?.substring(0, 50)}`,
	);
}

// 8.6 非法角色 → tool_call 拦截器使用 customer 权限
{
	setupRole(mockPi, "guest");
	const blockedResult = emitToolCall(mockPi, "fetch_market_trend");
	check(
		"非法角色 tool_call fetch_market_trend → 被拦截（回退 customer 无权限）",
		blockedResult?.block === true,
	);

	const allowedResult = emitToolCall(mockPi, "echo");
	check(
		"非法角色 tool_call echo → 放行（customer 有权限）",
		allowedResult === undefined || allowedResult?.block !== true,
	);
}

// ================================================================
// 额外：session_start 不重复过滤（无禁用工具时不调 setActiveTools）
// ================================================================

section("额外：session_start 无需过滤时不修改 activeTools");

{
	// customer 角色下 activeTools 已经只有 customer 可用的工具
	// 再次触发 session_start 不应改变 activeTools
	setupRole(mockPi, "customer");

	// 手动设置 activeTools 为已经是 customer 子集的工具
	mockPi.setActiveTools(["echo", "query_outfit"]);
	mockPi.emit("session_start", { type: "session_start", reason: "reload" });
	const toolsAfterSecondStart = mockPi.getActiveTools();

	check(
		"session_start 无需过滤时保持 activeTools 不变",
		toolsAfterSecondStart.length === 2 &&
			toolsAfterSecondStart.includes("echo") &&
			toolsAfterSecondStart.includes("query_outfit"),
		`实际：${toolsAfterSecondStart.join(", ")}`,
	);
}

// ================================================================
// 额外：验证角色切换后 currentRole 正确更新
// ================================================================

section("额外：角色切换后 currentRole 正确更新");

{
	// customer → merchant → admin 顺序切换
	setupRole(mockPi, "customer");
	const customerCheck = emitToolCall(mockPi, "test_customer_only");
	check(
		"customer 阶段 → test_customer_only 放行",
		customerCheck === undefined || customerCheck?.block !== true,
	);

	setupRole(mockPi, "merchant");
	const merchantCheck = emitToolCall(mockPi, "test_customer_only");
	check(
		"切换到 merchant 后 → test_customer_only 被拦截",
		merchantCheck?.block === true,
		`实际：${JSON.stringify(merchantCheck)}`,
	);

	setupRole(mockPi, "admin");
	const adminCheck = emitToolCall(mockPi, "test_customer_only");
	check(
		"切换到 admin 后 → test_customer_only 被拦截",
		adminCheck?.block === true,
	);

	const adminOutfitCheck = emitToolCall(mockPi, "query_outfit");
	check(
		"admin 阶段 → query_outfit 放行",
		adminOutfitCheck === undefined || adminOutfitCheck?.block !== true,
	);
}

// ================================================================
// 总结
// ================================================================

console.log("\n========================================");
console.log(`通过：${passCount}  失败：${failCount}`);
console.log("========================================");
if (failCount > 0) {
	console.error("\n\u274C 集成测试失败，请检查上方失败项。");
	process.exit(1);
} else {
	console.log("\n\u2705 所有集成测试通过！Task 9 端到端集成验证成功。");
	console.log(`\n已验证：`);
	console.log(`  - 12 个工具全部注册`);
	console.log(`  - --role flag 注册，默认 customer`);
	console.log(`  - 3 个事件处理器（session_start / tool_call / before_agent_start）`);
	console.log(`  - customer / merchant / admin 三种角色的工具白名单过滤`);
	console.log(`  - tool_call 拦截器的防御性权限检查`);
	console.log(`  - before_agent_start 角色上下文注入`);
	console.log(`  - query_outfit → regenerate_outfit 全链路（mock fetch）`);
	console.log(`  - fetch_market_trend → analyze_competitors → generate_selection_report 全链路`);
	console.log(`  - 非法角色回退 customer`);
	console.log(`  - 非 mall-skills 工具默认放行`);
}
