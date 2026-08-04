/**
 * Product Research Skill 验证脚本
 *
 * 不依赖 LLM，也不依赖运行中的 ZMall 服务器，直接验证：
 *   1. productResearchSkillConfig 配置结构（allowedRoles = ["merchant", "admin"], 4 个工具）
 *   2. 角色权限：customer 被拦截，merchant/admin 放行
 *   3. fetch_market_trend mock 数据生成（确定性、字段完整）
 *   4. analyze_competitors mock 分析（基于 marketData / competitorUrls）
 *   5. generate_selection_report 产出合法 Markdown
 *   6. 工具注册（mock pi 对象，验证 4 个工具被正确注册）
 *
 * 运行方式（从 monorepo 根目录）：
 *   D:\nvm\v22.19.0\node.exe node_modules\tsx\dist\cli.mjs --tsconfig tsconfig.json \
 *     packages\mall-skills\test\verify-product-research.ts
 */

import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { buildToolPermissionMap, isToolAllowed } from "../src/index.ts";
import {
	registerProductResearchSkill,
	productResearchSkillConfig,
	hashString,
	createSeededRng,
	generateMarketTrendData,
	generateCompetitorAnalysis,
	generateSelectionReportMarkdown,
} from "../src/skills/product-research.ts";

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

// ===== 测试 1：productResearchSkillConfig 配置结构 =====
section("测试 1：productResearchSkillConfig 配置结构");

check(
	'skill name === "product-research"',
	productResearchSkillConfig.name === "product-research",
	`实际：${productResearchSkillConfig.name}`,
);

check(
	"allowedRoles 包含 2 个角色",
	productResearchSkillConfig.allowedRoles.length === 2,
	`实际长度：${productResearchSkillConfig.allowedRoles.length}`,
);
check(
	'allowedRoles 包含 "merchant"',
	productResearchSkillConfig.allowedRoles.includes("merchant"),
);
check(
	'allowedRoles 包含 "admin"',
	productResearchSkillConfig.allowedRoles.includes("admin"),
);
check(
	'allowedRoles 不包含 "customer"',
	!productResearchSkillConfig.allowedRoles.includes("customer"),
	`实际：${JSON.stringify(productResearchSkillConfig.allowedRoles)}`,
);
check(
	"toolNames 包含 4 个工具",
	productResearchSkillConfig.toolNames.length === 4,
	`实际长度：${productResearchSkillConfig.toolNames.length}`,
);
check(
	'toolNames 包含 "fetch_market_trend"',
	productResearchSkillConfig.toolNames.includes("fetch_market_trend"),
);
check(
	'toolNames 包含 "analyze_competitors"',
	productResearchSkillConfig.toolNames.includes("analyze_competitors"),
);
check(
	'toolNames 包含 "query_zmall_items"',
	productResearchSkillConfig.toolNames.includes("query_zmall_items"),
);
check(
	'toolNames 包含 "generate_selection_report"',
	productResearchSkillConfig.toolNames.includes("generate_selection_report"),
);

// ===== 测试 2：角色权限 - customer 被拦截 =====
section("测试 2：角色权限 - customer 被拦截");

const permissionMap = buildToolPermissionMap();

const productResearchToolNames = [
	"fetch_market_trend",
	"analyze_competitors",
	"query_zmall_items",
	"generate_selection_report",
];

for (const toolName of productResearchToolNames) {
	check(
		`权限映射包含 ${toolName}`,
		permissionMap.has(toolName),
	);
}

// customer 角色应被全部拦截
for (const toolName of productResearchToolNames) {
	check(
		`customer 被拦截使用 ${toolName}`,
		isToolAllowed(toolName, "customer", permissionMap) === false,
		`实际：${isToolAllowed(toolName, "customer", permissionMap)}`,
	);
}

// ===== 测试 3：角色权限 - merchant / admin 放行 =====
section("测试 3：角色权限 - merchant / admin 放行");

for (const role of ["merchant", "admin"] as const) {
	for (const toolName of productResearchToolNames) {
		check(
			`${role} 允许使用 ${toolName}`,
			isToolAllowed(toolName, role, permissionMap) === true,
			`实际：${isToolAllowed(toolName, role, permissionMap)}`,
		);
	}
}

// ===== 测试 4：hashString 确定性哈希 =====
section("测试 4：hashString 确定性哈希");

check(
	"相同输入产生相同哈希",
	hashString("女装连衣裙|30|CN") === hashString("女装连衣裙|30|CN"),
);
check(
	"不同输入产生不同哈希",
	hashString("女装连衣裙|30|CN") !== hashString("男鞋|30|CN"),
);
check(
	"哈希为非负整数",
	hashString("test") >= 0 && Number.isInteger(hashString("test")),
);
check(
	"空字符串也能哈希",
	hashString("") >= 0,
);

// ===== 测试 5：createSeededRng 确定性随机 =====
section("测试 5：createSeededRng 确定性随机");

const rng1 = createSeededRng(12345);
const rng2 = createSeededRng(12345);
const rng3 = createSeededRng(67890);

const seq1 = [rng1(), rng1(), rng1()];
const seq2 = [rng2(), rng2(), rng2()];
const seq3 = [rng3(), rng3(), rng3()];

check(
	"相同种子产生相同序列",
	seq1[0] === seq2[0] && seq1[1] === seq2[1] && seq1[2] === seq2[2],
	`seq1: ${seq1.join(",")}  seq2: ${seq2.join(",")}`,
);
check(
	"不同种子产生不同序列",
	seq1[0] !== seq3[0] || seq1[1] !== seq3[1],
);
check(
	"随机数在 [0, 1) 区间",
	seq1[0] >= 0 && seq1[0] < 1 && seq1[1] >= 0 && seq1[1] < 1,
);

// ===== 测试 6：fetch_market_trend mock 数据生成 =====
section("测试 6：fetch_market_trend mock 数据生成");

const trend1 = generateMarketTrendData("女装连衣裙", 30, "CN");
const trend2 = generateMarketTrendData("女装连衣裙", 30, "CN");
const trend3 = generateMarketTrendData("男鞋", 30, "CN");

check(
	"返回 category 字段",
	trend1.category === "女装连衣裙",
);
check(
	"返回 days 字段",
	trend1.days === 30,
);
check(
	"trendScore 在 0-100 区间",
	trend1.trendScore >= 0 && trend1.trendScore <= 100,
	`实际：${trend1.trendScore}`,
);
check(
	"demandLevel 为 high/medium/low",
	trend1.demandLevel === "high" || trend1.demandLevel === "medium" || trend1.demandLevel === "low",
	`实际：${trend1.demandLevel}`,
);
check(
	"priceRange.min 为非负数",
	trend1.priceRange.min >= 0,
);
check(
	"priceRange.max >= priceRange.min",
	trend1.priceRange.max >= trend1.priceRange.min,
);
check(
	"trendingKeywords 有 5 个关键词",
	trend1.trendingKeywords.length === 5,
	`实际长度：${trend1.trendingKeywords.length}`,
);
check(
	"trendingKeywords 元素为非空字符串",
	trend1.trendingKeywords.every((k) => typeof k === "string" && k.length > 0),
);
check(
	"topProducts 有 10 个商品",
	trend1.topProducts.length === 10,
	`实际长度：${trend1.topProducts.length}`,
);
check(
	"每个 topProduct 包含 name/price/trendScore/reason",
	trend1.topProducts.every(
		(p) =>
			typeof p.name === "string" &&
			typeof p.price === "number" &&
			typeof p.trendScore === "number" &&
			typeof p.reason === "string",
	),
);
check(
	"每个 topProduct trendScore 在 0-100",
	trend1.topProducts.every((p) => p.trendScore >= 0 && p.trendScore <= 100),
);
check(
	"每个 topProduct price 在 priceRange 内",
	trend1.topProducts.every((p) => p.price >= trend1.priceRange.min && p.price <= trend1.priceRange.max),
);
check(
	"dataSource 标记为 mock (MVP)",
	trend1.dataSource === "mock (MVP)",
	`实际：${trend1.dataSource}`,
);
check(
	"fetchedAt 为 ISO 字符串",
	typeof trend1.fetchedAt === "string" && trend1.fetchedAt.includes("T"),
);

// 确定性：相同输入 → 相同输出
check(
	"确定性：相同输入产生相同 trendScore",
	trend1.trendScore === trend2.trendScore,
	`trend1: ${trend1.trendScore}  trend2: ${trend2.trendScore}`,
);
check(
	"确定性：相同输入产生相同 topProducts",
	JSON.stringify(trend1.topProducts) === JSON.stringify(trend2.topProducts),
);
check(
	"确定性：相同输入产生相同 trendingKeywords",
	JSON.stringify(trend1.trendingKeywords) === JSON.stringify(trend2.trendingKeywords),
);
check(
	"不同品类产生不同 trendScore",
	JSON.stringify(trend1.topProducts) !== JSON.stringify(trend3.topProducts),
);

// ===== 测试 7：analyze_competitors mock 分析（基于 marketData）=====
section("测试 7：analyze_competitors mock 分析（基于 marketData）");

const compAnalysis1 = generateCompetitorAnalysis("女装连衣裙", trend1);
const compAnalysis2 = generateCompetitorAnalysis("女装连衣裙", trend1);

check(
	"返回 category 字段",
	compAnalysis1.category === "女装连衣裙",
);
check(
	"competitorCount 等于 marketData.topProducts.length",
	compAnalysis1.competitorCount === trend1.topProducts.length,
	`实际：${compAnalysis1.competitorCount}`,
);
check(
	"competitorCount 为 10（marketData 提供）",
	compAnalysis1.competitorCount === 10,
);
check(
	"priceDistribution 包含 budget/midRange/premium",
	"budget" in compAnalysis1.priceDistribution &&
		"midRange" in compAnalysis1.priceDistribution &&
		"premium" in compAnalysis1.priceDistribution,
);
check(
	"priceDistribution 三段之和等于 competitorCount",
	compAnalysis1.priceDistribution.budget +
		compAnalysis1.priceDistribution.midRange +
		compAnalysis1.priceDistribution.premium ===
		compAnalysis1.competitorCount,
	`实际：${JSON.stringify(compAnalysis1.priceDistribution)} 总和应=${compAnalysis1.competitorCount}`,
);
check(
	"averagePrice 为非负数",
	compAnalysis1.averagePrice >= 0,
);
check(
	"priceRange.min <= averagePrice <= priceRange.max",
	compAnalysis1.priceRange.min <= compAnalysis1.averagePrice &&
		compAnalysis1.averagePrice <= compAnalysis1.priceRange.max,
);
check(
	"priceVariance 为非负数",
	compAnalysis1.priceVariance >= 0,
);
check(
	"commonSellingPoints 有 4 个",
	compAnalysis1.commonSellingPoints.length === 4,
	`实际长度：${compAnalysis1.commonSellingPoints.length}`,
);
check(
	"commonWeaknesses 有 3 个",
	compAnalysis1.commonWeaknesses.length === 3,
	`实际长度：${compAnalysis1.commonWeaknesses.length}`,
);
check(
	"marketSaturation 为 low/medium/high",
	compAnalysis1.marketSaturation === "low" ||
		compAnalysis1.marketSaturation === "medium" ||
		compAnalysis1.marketSaturation === "high",
);
check(
	"analysis 为非空字符串",
	typeof compAnalysis1.analysis === "string" && compAnalysis1.analysis.length > 0,
);
check(
	"analyzedAt 为 ISO 字符串",
	typeof compAnalysis1.analyzedAt === "string" && compAnalysis1.analyzedAt.includes("T"),
);
check(
	"确定性：相同输入产生相同竞品分析",
	JSON.stringify(compAnalysis1) === JSON.stringify(compAnalysis2),
);

// ===== 测试 8：analyze_competitors mock 分析（基于 competitorUrls）=====
section("测试 8：analyze_competitors mock 分析（基于 competitorUrls）");

const competitorUrls = [
	"https://example.com/p/1",
	"https://example.com/p/2",
	"https://example.com/p/3",
];
const compByUrl1 = generateCompetitorAnalysis("男鞋", undefined, competitorUrls);
const compByUrl2 = generateCompetitorAnalysis("男鞋", undefined, competitorUrls);

check(
	"competitorCount 等于 competitorUrls.length",
	compByUrl1.competitorCount === competitorUrls.length,
	`实际：${compByUrl1.competitorCount}`,
);
check(
	"priceDistribution 三段之和等于 competitorCount",
	compByUrl1.priceDistribution.budget +
		compByUrl1.priceDistribution.midRange +
		compByUrl1.priceDistribution.premium ===
		compByUrl1.competitorCount,
);
check(
	"确定性：相同 competitorUrls 产生相同分析",
	JSON.stringify(compByUrl1) === JSON.stringify(compByUrl2),
);

// ===== 测试 9：analyze_competitors mock 分析（无 marketData 无 competitorUrls）=====
section("测试 9：analyze_competitors mock 分析（无输入，降级生成）");

const compFallback = generateCompetitorAnalysis("手机配件");
check(
	"降级时 competitorCount >= 3",
	compFallback.competitorCount >= 3,
	`实际：${compFallback.competitorCount}`,
);
check(
	"降级时 competitorCount <= 10",
	compFallback.competitorCount <= 10,
	`实际：${compFallback.competitorCount}`,
);

// ===== 测试 10：generate_selection_report Markdown 生成（无 zmallInventory）=====
section("测试 10：generate_selection_report Markdown 生成（无 zmallInventory）");

const reportResult1 = generateSelectionReportMarkdown("女装连衣裙", trend1, compAnalysis1);

check(
	"返回 report 字段",
	typeof reportResult1.report === "string" && reportResult1.report.length > 0,
);
check(
	"返回 summary 字段",
	typeof reportResult1.summary === "string" && reportResult1.summary.length > 0,
);
check(
	"返回 generatedAt 字段",
	typeof reportResult1.generatedAt === "string" && reportResult1.generatedAt.includes("T"),
);
check(
	"report 包含一级标题 # 选品研究报告",
	reportResult1.report.includes("# 选品研究报告"),
);
check(
	"report 包含品类名",
	reportResult1.report.includes("女装连衣裙"),
);
check(
	"report 包含趋势概览章节",
	reportResult1.report.includes("趋势概览"),
);
check(
	"report 包含 Top 10 爆品清单章节",
	reportResult1.report.includes("Top 10 爆品清单"),
);
check(
	"report 包含竞品价格区间章节",
	reportResult1.report.includes("竞品价格区间"),
);
check(
	"report 包含选品建议章节",
	reportResult1.report.includes("选品建议"),
);
check(
	"report 包含 Markdown 表格（| --- |）",
	reportResult1.report.includes("| --- |"),
);
check(
	"report 包含 trendScore",
	reportResult1.report.includes(String(trend1.trendScore)),
);
check(
	"report 包含 averagePrice",
	reportResult1.report.includes(String(compAnalysis1.averagePrice)),
);
check(
	"report 不包含现有库存分析章节（未提供 zmallInventory）",
	!reportResult1.report.includes("现有库存分析"),
);
check(
	"summary 包含品类名",
	reportResult1.summary.includes("女装连衣裙"),
);

// ===== 测试 11：generate_selection_report Markdown 生成（含 zmallInventory）=====
section("测试 11：generate_selection_report Markdown 生成（含 zmallInventory）");

const mockZmallInventory = {
	total: 25,
	pages: 2,
	items: [
		{ id: 101, name: "测试商品A", price: 99.9, stock: 50, sold: 120, category: "女装" },
		{ id: 102, name: "测试商品B", price: 159, stock: 30, sold: 80, category: "女装" },
	],
	message: "Query successful",
};

const reportResult2 = generateSelectionReportMarkdown("女装连衣裙", trend1, compAnalysis1, mockZmallInventory);

check(
	"report 包含现有库存分析章节（提供了 zmallInventory）",
	reportResult2.report.includes("现有库存分析"),
);
check(
	"report 包含库存商品总数",
	reportResult2.report.includes("25"),
);
check(
	"report 包含库存商品名称",
	reportResult2.report.includes("测试商品A"),
);
check(
	"report 包含库存表格表头",
	reportResult2.report.includes("商品 ID"),
);

// ===== 测试 12：generate_selection_report 不包含库存（zmallInventory 带 error）=====
section("测试 12：generate_selection_report 不包含库存（zmallInventory 带 error）");

const errorInventory = {
	error: "ZMall service unavailable",
	hint: "请确认后端已启动",
};
const reportResult3 = generateSelectionReportMarkdown(
	"女装连衣裙",
	trend1,
	compAnalysis1,
	errorInventory as never,
);

check(
	"zmallInventory 带 error 时不输出库存章节",
	!reportResult3.report.includes("现有库存分析"),
);

// ===== 测试 13：工具注册（mock pi 对象）=====
section("测试 13：工具注册（mock pi 对象）");

registerProductResearchSkill(mockPi as ExtensionAPI);

check(
	"注册了 4 个工具",
	registeredTools.size === 4,
	`实际数量：${registeredTools.size}`,
);
check(
	"fetch_market_trend 工具已注册",
	registeredTools.has("fetch_market_trend"),
);
check(
	"analyze_competitors 工具已注册",
	registeredTools.has("analyze_competitors"),
);
check(
	"query_zmall_items 工具已注册",
	registeredTools.has("query_zmall_items"),
);
check(
	"generate_selection_report 工具已注册",
	registeredTools.has("generate_selection_report"),
);

// ===== 测试 14：fetch_market_trend 工具结构 =====
section("测试 14：fetch_market_trend 工具结构");

const fetchTool = registeredTools.get("fetch_market_trend");
check("fetch_market_trend 工具存在", fetchTool !== undefined);
check(
	'fetch_market_trend label === "Fetch Market Trend"',
	fetchTool?.label === "Fetch Market Trend",
	`实际：${fetchTool?.label}`,
);
check(
	"fetch_market_trend description 非空",
	typeof fetchTool?.description === "string" && fetchTool.description.length > 0,
);
check(
	"fetch_market_trend promptSnippet 非空",
	typeof fetchTool?.promptSnippet === "string" && fetchTool.promptSnippet.length > 0,
);

const fetchParams = fetchTool?.parameters as { properties?: Record<string, unknown> };
check(
	"fetch_market_trend 参数包含 category（必填）",
	fetchParams?.properties?.category !== undefined,
);
check(
	"fetch_market_trend 参数包含 days",
	fetchParams?.properties?.days !== undefined,
);
check(
	"fetch_market_trend 参数包含 region",
	fetchParams?.properties?.region !== undefined,
);

// ===== 测试 15：analyze_competitors 工具结构 =====
section("测试 15：analyze_competitors 工具结构");

const analyzeTool = registeredTools.get("analyze_competitors");
check("analyze_competitors 工具存在", analyzeTool !== undefined);
check(
	'analyze_competitors label === "Analyze Competitors"',
	analyzeTool?.label === "Analyze Competitors",
	`实际：${analyzeTool?.label}`,
);
check(
	"analyze_competitors description 非空",
	typeof analyzeTool?.description === "string" && analyzeTool.description.length > 0,
);
check(
	"analyze_competitors promptSnippet 非空",
	typeof analyzeTool?.promptSnippet === "string" && analyzeTool.promptSnippet.length > 0,
);

const analyzeParams = analyzeTool?.parameters as { properties?: Record<string, unknown> };
check(
	"analyze_competitors 参数包含 category（必填）",
	analyzeParams?.properties?.category !== undefined,
);
check(
	"analyze_competitors 参数包含 marketData",
	analyzeParams?.properties?.marketData !== undefined,
);
check(
	"analyze_competitors 参数包含 competitorUrls",
	analyzeParams?.properties?.competitorUrls !== undefined,
);

// ===== 测试 16：query_zmall_items 工具结构 =====
section("测试 16：query_zmall_items 工具结构");

const queryTool = registeredTools.get("query_zmall_items");
check("query_zmall_items 工具存在", queryTool !== undefined);
check(
	'query_zmall_items label === "Query ZMall Items"',
	queryTool?.label === "Query ZMall Items",
	`实际：${queryTool?.label}`,
);
check(
	"query_zmall_items description 非空",
	typeof queryTool?.description === "string" && queryTool.description.length > 0,
);
check(
	"query_zmall_items promptSnippet 非空",
	typeof queryTool?.promptSnippet === "string" && queryTool.promptSnippet.length > 0,
);

const queryParams = queryTool?.parameters as { properties?: Record<string, unknown> };
check(
	"query_zmall_items 参数包含 keyword",
	queryParams?.properties?.keyword !== undefined,
);
check(
	"query_zmall_items 参数包含 category",
	queryParams?.properties?.category !== undefined,
);
check(
	"query_zmall_items 参数包含 pageNo",
	queryParams?.properties?.pageNo !== undefined,
);
check(
	"query_zmall_items 参数包含 pageSize",
	queryParams?.properties?.pageSize !== undefined,
);

// ===== 测试 17：generate_selection_report 工具结构 =====
section("测试 17：generate_selection_report 工具结构");

const reportTool = registeredTools.get("generate_selection_report");
check("generate_selection_report 工具存在", reportTool !== undefined);
check(
	'generate_selection_report label === "Generate Selection Report"',
	reportTool?.label === "Generate Selection Report",
	`实际：${reportTool?.label}`,
);
check(
	"generate_selection_report description 非空",
	typeof reportTool?.description === "string" && reportTool.description.length > 0,
);
check(
	"generate_selection_report promptSnippet 非空",
	typeof reportTool?.promptSnippet === "string" && reportTool.promptSnippet.length > 0,
);

const reportParams = reportTool?.parameters as { properties?: Record<string, unknown> };
check(
	"generate_selection_report 参数包含 category（必填）",
	reportParams?.properties?.category !== undefined,
);
check(
	"generate_selection_report 参数包含 marketTrend（必填）",
	reportParams?.properties?.marketTrend !== undefined,
);
check(
	"generate_selection_report 参数包含 competitorAnalysis（必填）",
	reportParams?.properties?.competitorAnalysis !== undefined,
);
check(
	"generate_selection_report 参数包含 zmallInventory（可选）",
	reportParams?.properties?.zmallInventory !== undefined,
);

// ===== 测试 18：工具 execute 函数存在 =====
section("测试 18：工具 execute 函数存在");

for (const toolName of productResearchToolNames) {
	const tool = registeredTools.get(toolName);
	check(
		`${toolName} 有 execute 函数`,
		typeof tool?.execute === "function",
	);
}

// ===== 测试 19：fetch_market_trend 工具 execute 调用（不依赖 LLM）=====
section("测试 19：fetch_market_trend 工具 execute 调用");

const fetchExecTool = registeredTools.get("fetch_market_trend");
if (fetchExecTool) {
	const execResult = await fetchExecTool.execute(
		"test-call-id",
		{ category: "女装连衣裙", days: 30, region: "CN" },
		undefined,
		undefined,
		{} as never,
	);

	check(
		"execute 返回 content 数组",
		Array.isArray(execResult.content) && execResult.content.length > 0,
	);
	check(
		"execute 返回 content[0].type === text",
		execResult.content[0]?.type === "text",
	);
	check(
		"execute 返回 content[0].text 非空",
		typeof execResult.content[0]?.text === "string" && execResult.content[0].text.length > 0,
	);
	check(
		"execute 返回 details.category",
		(execResult.details as { category?: string }).category === "女装连衣裙",
	);
	check(
		"execute 返回 details.trendScore 在 0-100",
		(execResult.details as { trendScore?: number }).trendScore !== undefined &&
			(execResult.details as { trendScore: number }).trendScore >= 0 &&
			(execResult.details as { trendScore: number }).trendScore <= 100,
	);
	check(
		"execute 返回 details.topProducts 有 10 个",
		(execResult.details as { topProducts?: unknown[] }).topProducts?.length === 10,
	);
}

// ===== 测试 20：analyze_competitors 工具 execute 调用 =====
section("测试 20：analyze_competitors 工具 execute 调用");

const analyzeExecTool = registeredTools.get("analyze_competitors");
if (analyzeExecTool) {
	const execResult = await analyzeExecTool.execute(
		"test-call-id",
		{ category: "女装连衣裙", marketData: trend1 },
		undefined,
		undefined,
		{} as never,
	);

	check(
		"execute 返回 content 数组",
		Array.isArray(execResult.content) && execResult.content.length > 0,
	);
	check(
		"execute 返回 details.competitorCount",
		(execResult.details as { competitorCount?: number }).competitorCount !== undefined,
	);
	check(
		"execute 返回 details.averagePrice",
		(execResult.details as { averagePrice?: number }).averagePrice !== undefined,
	);
	check(
		"execute 返回 details.marketSaturation",
		typeof (execResult.details as { marketSaturation?: string }).marketSaturation === "string",
	);
}

// ===== 测试 21：generate_selection_report 工具 execute 调用 =====
section("测试 21：generate_selection_report 工具 execute 调用");

const reportExecTool = registeredTools.get("generate_selection_report");
if (reportExecTool) {
	const execResult = await reportExecTool.execute(
		"test-call-id",
		{
			category: "女装连衣裙",
			marketTrend: trend1,
			competitorAnalysis: compAnalysis1,
		},
		undefined,
		undefined,
		{} as never,
	);

	check(
		"execute 返回 content 数组",
		Array.isArray(execResult.content) && execResult.content.length > 0,
	);
	check(
		"execute content[0].text 为 Markdown（含 # 选品研究报告）",
		typeof execResult.content[0]?.text === "string" &&
			execResult.content[0].text.includes("# 选品研究报告"),
	);
	check(
		"execute 返回 details.report",
		typeof (execResult.details as { report?: string }).report === "string",
	);
	check(
		"execute 返回 details.summary",
		typeof (execResult.details as { summary?: string }).summary === "string",
	);
	check(
		"execute 返回 details.generatedAt",
		typeof (execResult.details as { generatedAt?: string }).generatedAt === "string",
	);
}

// ===== 测试 22：generate_selection_report 工具 execute 缺参数时返回错误 =====
section("测试 22：generate_selection_report 工具 execute 缺参数时返回错误");

const reportExecTool2 = registeredTools.get("generate_selection_report");
if (reportExecTool2) {
	const execResult = await reportExecTool2.execute(
		"test-call-id",
		{
			category: "女装连衣裙",
			marketTrend: undefined,
			competitorAnalysis: undefined,
		},
		undefined,
		undefined,
		{} as never,
	);

	check(
		"缺参数时返回错误提示",
		typeof execResult.content[0]?.text === "string" &&
			execResult.content[0].text.includes("失败"),
	);
}

// ===== 总结 =====
console.log("\n========================================");
console.log(`通过：${passCount}  失败：${failCount}`);
console.log("========================================");
if (failCount > 0) {
	console.error("\n\u274C Product Research Skill 验证失败，请检查上方失败项。");
	process.exit(1);
} else {
	console.log("\n\u2705 所有测试通过！Task 8 AI Product Research Skill 验证成功。");
	console.log(`\n已注册工具：${[...registeredTools.keys()].join(", ")}`);
	console.log(`\n角色权限：${JSON.stringify(productResearchSkillConfig.allowedRoles)}`);
	console.log(`\n下一步：启动 ZMall 后端后，用以下命令端到端验证：`);
	console.log(`  D:\\nvm\\v22.19.0\\node.exe node_modules\\tsx\\dist\\cli.mjs \\`);
	console.log(`    --tsconfig tsconfig.json \\`);
	console.log(`    packages\\coding-agent\\src\\cli.ts \\`);
	console.log(`    --provider <provider> --model <model> --role merchant \\`);
	console.log(`    -p "Use fetch_market_trend to research 女装连衣裙"`);
}
