/**
 * Product Research Skill - AI 选品研究能力
 *
 * 为后台工作台（merchant/admin 角色）提供 AI 驱动的选品研究工具：
 * 1. fetch_market_trend       —— 获取品类市场趋势数据（MVP 使用确定性 mock 数据）
 * 2. analyze_competitors      —— 基于市场数据或竞品 URL 分析竞品
 * 3. query_zmall_items        —— 查询 ZMall 现有库存商品
 * 4. generate_selection_report —— 汇总生成 Markdown 选品报告
 *
 * 角色限制：仅 merchant 和 admin 可用，customer 不可见。
 *
 * NOTE: MVP 阶段市场趋势与竞品分析使用确定性 mock 数据（相同输入 → 相同输出），
 * 生产环境应替换为真实的市场数据 API（如生意参谋、DataEye 等）。
 */

import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { MallSkillConfig } from "../types.ts";
import { getCurrentPlatform } from "../index.ts";

// ===== 常量 =====

const REQUEST_TIMEOUT_MS = 10_000;

/** 需求等级类型 */
type DemandLevel = "high" | "medium" | "low";

/** 市场饱和度类型 */
type MarketSaturation = "low" | "medium" | "high";

// ===== 导出的辅助函数（供测试使用）=====

/**
 * 简单字符串哈希（djb2 变体）。
 * 用于根据 category+days+region 生成确定性种子，保证 mock 数据可复现。
 */
export function hashString(input: string): number {
	let hash = 5381;
	for (let i = 0; i < input.length; i++) {
		// hash * 33 + char
		hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
	}
	return hash;
}

/**
 * 基于种子的确定性伪随机数生成器（线性同余 LCG）。
 * 返回一个函数，每次调用产生 [0, 1) 区间的浮点数。
 */
export function createSeededRng(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		// LCG 参数（同 glibc/ANSI C）
		state = (state * 1103515245 + 12345) >>> 0;
		return state / 0x100000000;
	};
}

/** 生成 mock 市场趋势数据（导出供测试直接调用） */
export function generateMarketTrendData(category: string, days: number, region: string): MarketTrendData {
	const seed = hashString(`${category}|${days}|${region}`);
	const rng = createSeededRng(seed);

	const trendScore = Math.floor(rng() * 60) + 40; // 40-100
	const demandLevel: DemandLevel = trendScore > 75 ? "high" : trendScore > 55 ? "medium" : "low";

	const priceMin = Math.floor(rng() * 50) + 20; // 20-70
	const priceMax = priceMin + Math.floor(rng() * 300) + 100; // min+100 ~ min+400

	const keywordPool = [
		"新款", "夏季", "冬季", "爆款", "简约", "复古", "潮流", "韩版", "日系", "欧美",
		"宽松", "修身", "显瘦", "百搭", "ins风", "高腰", "大码", "修身", "纯色", "印花",
	];
	const trendingKeywords: string[] = [];
	while (trendingKeywords.length < 5) {
		const idx = Math.floor(rng() * keywordPool.length);
		const kw = keywordPool[idx];
		if (!trendingKeywords.includes(kw)) {
			trendingKeywords.push(kw);
		}
	}

	const productAdjectives = ["时尚", "经典", "高端", "平价", "潮流", "复古", "简约", "奢华", "休闲", "商务"];
	const productNouns = ["款", "套装", "系列", "单品", "套装", "礼盒装"];
	const reasons = [
		"近期搜索量大幅上升",
		"社交媒体讨论度走高",
		"季节性需求增加",
		"网红达人推荐",
		"复购率较高",
		"利润空间充足",
		"供应链稳定",
		"差异化卖点突出",
	];

	const topProducts: TopProduct[] = [];
	for (let i = 0; i < 10; i++) {
		const adj = productAdjectives[Math.floor(rng() * productAdjectives.length)];
		const noun = productNouns[Math.floor(rng() * productNouns.length)];
		const price = Math.floor(rng() * (priceMax - priceMin)) + priceMin;
		const score = Math.floor(rng() * 40) + 55; // 55-95
		const reason = reasons[Math.floor(rng() * reasons.length)];
		topProducts.push({
			name: `${category}${adj}${noun}`,
			price,
			trendScore: score,
			reason,
		});
	}

	return {
		category,
		days,
		trendScore,
		demandLevel,
		priceRange: { min: priceMin, max: priceMax },
		trendingKeywords,
		topProducts,
		dataSource: "mock (MVP)",
		fetchedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
	};
}

/** 生成 mock 竞品分析数据（导出供测试直接调用） */
export function generateCompetitorAnalysis(
	category: string,
	marketData?: MarketTrendData,
	competitorUrls?: string[],
): CompetitorAnalysis {
	const seed = hashString(`competitor|${category}|${marketData?.trendScore ?? 0}|${competitorUrls?.length ?? 0}`);
	const rng = createSeededRng(seed);

	let competitorCount: number;
	let prices: number[];

	if (competitorUrls && competitorUrls.length > 0) {
		competitorCount = competitorUrls.length;
		prices = competitorUrls.map(() => Math.floor(rng() * 400) + 30);
	} else if (marketData?.topProducts && marketData.topProducts.length > 0) {
		competitorCount = marketData.topProducts.length;
		prices = marketData.topProducts.map((p) => p.price);
	} else {
		competitorCount = Math.floor(rng() * 8) + 3; // 3-10
		prices = [];
		for (let i = 0; i < competitorCount; i++) {
			prices.push(Math.floor(rng() * 400) + 30);
		}
	}

	const sortedPrices = [...prices].sort((a, b) => a - b);
	const minPrice = sortedPrices[0] ?? 0;
	const maxPrice = sortedPrices[sortedPrices.length - 1] ?? 0;
	const averagePrice = prices.length > 0 ? Math.round(prices.reduce((s, p) => s + p, 0) / prices.length) : 0;
	const variance =
		prices.length > 0
			? Math.round(prices.reduce((s, p) => s + (p - averagePrice) ** 2, 0) / prices.length)
			: 0;

	// 价格区间分布：budget < avg*0.7, midRange avg*0.7~avg*1.3, premium > avg*1.3
	const budgetThreshold = averagePrice * 0.7;
	const premiumThreshold = averagePrice * 1.3;
	const budget = prices.filter((p) => p < budgetThreshold).length;
	const premium = prices.filter((p) => p > premiumThreshold).length;
	const midRange = prices.length - budget - premium;

	const sellingPointsPool = [
		"性价比高", "材质优良", "设计独特", "品牌知名度", "售后保障",
		"快速发货", "包装精美", "尺码齐全", "颜色丰富", "联名款",
	];
	const weaknessesPool = [
		"价格偏高", "款式单一", "库存不稳定", "退换货麻烦", "尺码偏小",
		"材质一般", "无品牌溢价", "物流较慢", "包装简陋", "缺少评价",
	];

	const sellingPoints: string[] = [];
	while (sellingPoints.length < 4) {
		const idx = Math.floor(rng() * sellingPointsPool.length);
		const sp = sellingPointsPool[idx];
		if (!sellingPoints.includes(sp)) {
			sellingPoints.push(sp);
		}
	}

	const weaknesses: string[] = [];
	while (weaknesses.length < 3) {
		const idx = Math.floor(rng() * weaknessesPool.length);
		const w = weaknessesPool[idx];
		if (!weaknesses.includes(w)) {
			weaknesses.push(w);
		}
	}

	const saturationScore = rng();
	const marketSaturation: MarketSaturation =
		saturationScore > 0.66 ? "high" : saturationScore > 0.33 ? "medium" : "low";

	const analysis = `品类"${category}"共有 ${competitorCount} 个竞品样本，平均价格 ${averagePrice} 元，价格区间 ${minPrice}-${maxPrice} 元。市场饱和度${marketSaturation === "high" ? "较高" : marketSaturation === "medium" ? "中等" : "较低"}，${demandLevelToText(marketData?.demandLevel)}。`;

	return {
		category,
		competitorCount,
		priceDistribution: { budget, midRange, premium },
		averagePrice,
		priceRange: { min: minPrice, max: maxPrice },
		priceVariance: variance,
		commonSellingPoints: sellingPoints,
		commonWeaknesses: weaknesses,
		marketSaturation,
		analysis,
		analyzedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
	};
}

/** 生成 Markdown 选品报告（导出供测试直接调用） */
export function generateSelectionReportMarkdown(
	category: string,
	marketTrend: MarketTrendData,
	competitorAnalysis: CompetitorAnalysis,
	zmallInventory?: ZmallInventory,
): { report: string; summary: string; generatedAt: string } {
	const generatedAt = new Date("2026-01-01T00:00:00.000Z").toISOString();

	const lines: string[] = [];
	lines.push(`# 选品研究报告：${category}`);
	lines.push("");
	lines.push(`> 生成时间：${generatedAt}`);
	lines.push(`> 数据来源：${marketTrend.dataSource}（MVP 阶段）`);
	lines.push("");

	// 趋势概览
	lines.push("## 一、趋势概览");
	lines.push("");
	lines.push(`| 指标 | 数值 |`);
	lines.push(`| --- | --- |`);
	lines.push(`| 品类 | ${marketTrend.category} |`);
	lines.push(`| 趋势评分 | ${marketTrend.trendScore} / 100 |`);
	lines.push(`| 需求等级 | ${marketTrend.demandLevel} |`);
	lines.push(`| 价格区间 | ${marketTrend.priceRange.min} - ${marketTrend.priceRange.max} 元 |`);
	lines.push(`| 市场区域 | 默认（${marketTrend.days} 天数据） |`);
	lines.push("");
	lines.push("**热门关键词：**");
	for (const kw of marketTrend.trendingKeywords) {
		lines.push(`- ${kw}`);
	}
	lines.push("");

	// Top10 爆品清单
	lines.push("## 二、Top 10 爆品清单");
	lines.push("");
	lines.push("| 排名 | 商品名称 | 价格（元） | 趋势评分 | 推荐理由 |");
	lines.push("| --- | --- | --- | --- | --- |");
	for (let i = 0; i < marketTrend.topProducts.length; i++) {
		const p = marketTrend.topProducts[i];
		lines.push(`| ${i + 1} | ${p.name} | ${p.price} | ${p.trendScore} | ${p.reason} |`);
	}
	lines.push("");

	// 竞品价格区间
	lines.push("## 三、竞品价格区间");
	lines.push("");
	lines.push(`- 竞品样本数：${competitorAnalysis.competitorCount}`);
	lines.push(`- 平均价格：${competitorAnalysis.averagePrice} 元`);
	lines.push(`- 价格区间：${competitorAnalysis.priceRange.min} - ${competitorAnalysis.priceRange.max} 元`);
	lines.push(`- 价格方差：${competitorAnalysis.priceVariance}`);
	lines.push("");
	lines.push("**价格段分布：**");
	lines.push("");
	lines.push("| 段位 | 数量 |");
	lines.push("| --- | --- |");
	lines.push(`| 低价位（budget） | ${competitorAnalysis.priceDistribution.budget} |`);
	lines.push(`| 中价位（midRange） | ${competitorAnalysis.priceDistribution.midRange} |`);
	lines.push(`| 高价位（premium） | ${competitorAnalysis.priceDistribution.premium} |`);
	lines.push("");
	lines.push(`**市场饱和度：** ${competitorAnalysis.marketSaturation}`);
	lines.push("");
	lines.push("**竞品常见卖点：**");
	for (const sp of competitorAnalysis.commonSellingPoints) {
		lines.push(`- ${sp}`);
	}
	lines.push("");
	lines.push("**竞品常见弱点：**");
	for (const w of competitorAnalysis.commonWeaknesses) {
		lines.push(`- ${w}`);
	}
	lines.push("");

	// 选品建议
	lines.push("## 四、选品建议");
	lines.push("");
	const suggestedMin = Math.max(marketTrend.priceRange.min, competitorAnalysis.priceRange.min);
	const suggestedMax = Math.min(marketTrend.priceRange.max, competitorAnalysis.averagePrice * 1.2);
	lines.push(`**建议价格区间：** ${Math.round(suggestedMin)} - ${Math.round(suggestedMax)} 元`);
	lines.push("");
	lines.push("**差异化切入点：**");
	lines.push(`- 针对竞品弱点（${competitorAnalysis.commonWeaknesses.slice(0, 2).join("、")}）进行优化`);
	lines.push(`- 突出"${competitorAnalysis.commonSellingPoints[0] ?? "性价比"}"之外的差异化卖点`);
	lines.push(`- 结合热门关键词（${marketTrend.trendingKeywords.slice(0, 3).join("、")}）优化标题与详情`);
	lines.push("");

	// 现有库存分析
	if (zmallInventory && !zmallInventory.error) {
		lines.push("## 五、现有库存分析");
		lines.push("");
		lines.push(`- 库存商品总数：${zmallInventory.total}`);
		lines.push(`- 当前页码商品数：${zmallInventory.items.length}`);
		lines.push("");
		if (zmallInventory.items.length > 0) {
			lines.push("| 商品 ID | 商品名称 | 价格（元） | 库存 | 销量 | 分类 |");
			lines.push("| --- | --- | --- | --- | --- | --- |");
			for (const item of zmallInventory.items) {
				lines.push(`| ${item.id} | ${item.name} | ${item.price} | ${item.stock} | ${item.sold} | ${item.category ?? "-"} |`);
			}
		} else {
			lines.push("> 当前无相关库存商品，建议尽快补货。");
		}
		lines.push("");
	}

	const summary = `选品报告已生成：品类"${category}"趋势评分 ${marketTrend.trendScore}/100，需求${marketTrend.demandLevel}，建议价格区间 ${Math.round(suggestedMin)}-${Math.round(suggestedMax)} 元，竞品饱和度${competitorAnalysis.marketSaturation}。`;

	return {
		report: lines.join("\n"),
		summary,
		generatedAt,
	};
}

// ===== 内部类型定义 =====

interface TopProduct {
	name: string;
	price: number;
	trendScore: number;
	reason: string;
}

interface MarketTrendData {
	category: string;
	days: number;
	trendScore: number;
	demandLevel: DemandLevel;
	priceRange: { min: number; max: number };
	trendingKeywords: string[];
	topProducts: TopProduct[];
	dataSource: string;
	fetchedAt: string;
}

interface CompetitorAnalysis {
	category: string;
	competitorCount: number;
	priceDistribution: { budget: number; midRange: number; premium: number };
	averagePrice: number;
	priceRange: { min: number; max: number };
	priceVariance: number;
	commonSellingPoints: string[];
	commonWeaknesses: string[];
	marketSaturation: MarketSaturation;
	analysis: string;
	analyzedAt: string;
}

interface ZmallInventoryItem {
	id: number | string;
	name: string;
	price: number;
	stock: number;
	sold: number;
	category?: string;
}

interface ZmallInventory {
	total: number;
	pages: number;
	items: ZmallInventoryItem[];
	message: string;
}

/** 需求等级转中文描述 */
function demandLevelToText(level?: DemandLevel): string {
	if (level === "high") return "需求旺盛";
	if (level === "medium") return "需求中等";
	if (level === "low") return "需求偏低";
	return "需求未知";
}

// ===== ZMall 查询实现 =====

/**
 * 通过当前平台适配器查询库存商品。
 * 平台不可用时返回结构化错误（不抛异常）。
 */
async function queryZmallItems(params: {
	keyword?: string;
	category?: string;
	pageNo?: number;
	pageSize?: number;
}): Promise<ZmallInventory | { error: string; hint: string }> {
	let platform: ReturnType<typeof getCurrentPlatform>;
	try {
		platform = getCurrentPlatform();
	} catch (err) {
		return {
			error: "Platform unavailable",
			hint: `无法获取当前平台适配器（${err instanceof Error ? err.message : "unknown error"}）。请确认 session 已启动。`,
		};
	}

	try {
		const result = await platform.queryItems({
			pageNo: params.pageNo ?? 1,
			pageSize: params.pageSize ?? 20,
			keyword: params.keyword,
			category: params.category,
		});

		const items: ZmallInventoryItem[] = result.items.map((item) => ({
			id: item.id,
			name: item.name,
			price: item.price,
			stock: item.stock,
			sold: item.sold ?? 0,
			category: item.category,
		}));

		return {
			total: result.total,
			pages: result.pages,
			items,
			message: "Query successful",
		};
	} catch (err) {
		return {
			error: "Platform query failed",
			hint: `查询平台商品失败（${err instanceof Error ? err.message : "unknown error"}）。请确认平台后端服务可用。`,
		};
	}
}

// ===== Skill 配置 =====

/** product-research skill 配置：仅 merchant/admin 可用 */
export const productResearchSkillConfig: MallSkillConfig = {
	name: "product-research",
	allowedRoles: ["merchant", "admin"],
	toolNames: ["fetch_market_trend", "analyze_competitors", "query_zmall_items", "generate_selection_report"],
};

// ===== 工具注册 =====

/**
 * 注册 product-research skill 到 agent。
 * 在 mall-skills 扩展入口中被调用。
 */
export function registerProductResearchSkill(pi: ExtensionAPI): void {
	// ===== Tool 1: fetch_market_trend =====
	const fetchMarketTrendTool = defineTool({
		name: "fetch_market_trend",
		label: "Fetch Market Trend",
		description:
			"Fetch market trend data for a product category. Returns trend score, demand level, price range, trending keywords, and top 10 trending products. MVP uses deterministic mock data.",
		promptSnippet:
			"Use the fetch_market_trend tool to research market trends for a product category. Provide the category name (e.g. 女装连衣裙), optional days (default 30) and region (default CN). Returns trend score, demand level, price range, trending keywords, and top 10 products.",
		parameters: Type.Object({
			category: Type.String({ description: "Product category, e.g. 女装连衣裙, 男鞋, 手机配件" }),
			days: Type.Optional(
				Type.Number({ description: "Time range in days (default 30)", minimum: 1, maximum: 365 }),
			),
			region: Type.Optional(Type.String({ description: "Market region code (default CN)" })),
		}),
		async execute(_toolCallId, params) {
			try {
				const category = params.category;
				const days = params.days ?? 30;
				const region = params.region ?? "CN";

				// MVP: 使用确定性 mock 数据。生产环境应替换为真实市场数据 API。
				const data = generateMarketTrendData(category, days, region);

				return {
					content: [
						{
							type: "text",
							text: `市场趋势数据已获取：品类"${category}"，趋势评分 ${data.trendScore}/100，需求等级 ${data.demandLevel}。`,
						},
					],
					details: data,
				};
			} catch (err) {
				return {
					content: [
						{
							type: "text",
							text: `获取市场趋势数据失败：${err instanceof Error ? err.message : "未知错误"}`,
						},
					],
					details: { error: "fetch_market_trend failed" },
				};
			}
		},
	});

	// ===== Tool 2: analyze_competitors =====
	const analyzeCompetitorsTool = defineTool({
		name: "analyze_competitors",
		label: "Analyze Competitors",
		description:
			"Analyze competitor products based on market trend data or specific competitor URLs. Returns price distribution, average price, common selling points, weaknesses, and market saturation.",
		promptSnippet:
			"Use the analyze_competitors tool to analyze competitor products. Pass marketData (from fetch_market_trend) or competitorUrls. Returns price distribution, average price, selling points, weaknesses, and saturation level.",
		parameters: Type.Object({
			category: Type.String({ description: "Product category to analyze" }),
			marketData: Type.Optional(
				Type.Unknown({ description: "Output from fetch_market_trend tool (optional)" }),
			),
			competitorUrls: Type.Optional(
				Type.Array(Type.String(), {
					description: "Specific competitor product URLs to analyze (optional)",
				}),
			),
		}),
		async execute(_toolCallId, params) {
			try {
				const category = params.category;
				const marketData = params.marketData as MarketTrendData | undefined;
				const competitorUrls = params.competitorUrls;

				// MVP: 使用确定性 mock 分析。生产环境应替换为真实竞品数据抓取与分析 API。
				const analysis = generateCompetitorAnalysis(category, marketData, competitorUrls);

				return {
					content: [
						{
							type: "text",
							text: `竞品分析完成：品类"${category}"，共 ${analysis.competitorCount} 个竞品，平均价格 ${analysis.averagePrice} 元，市场饱和度 ${analysis.marketSaturation}。`,
						},
					],
					details: analysis,
				};
			} catch (err) {
				return {
					content: [
						{
							type: "text",
							text: `竞品分析失败：${err instanceof Error ? err.message : "未知错误"}`,
						},
					],
					details: { error: "analyze_competitors failed" },
				};
			}
		},
	});

	// ===== Tool 3: query_zmall_items =====
	const queryZmallItemsTool = defineTool({
		name: "query_zmall_items",
		label: "Query ZMall Items",
		description:
			"Query existing ZMall items to check current inventory. Supports keyword search and category filter. Requires ZMall backend to be running.",
		promptSnippet:
			"Use the query_zmall_items tool to check what products are already in ZMall inventory. Supports keyword and category filters with pagination. Returns error gracefully if ZMall is unavailable.",
		parameters: Type.Object({
			keyword: Type.Optional(Type.String({ description: "Search keyword" })),
			category: Type.Optional(Type.String({ description: "Category name filter" })),
			pageNo: Type.Optional(Type.Number({ description: "Page number, starting from 1", minimum: 1 })),
			pageSize: Type.Optional(Type.Number({ description: "Items per page", minimum: 1, maximum: 100 })),
		}),
		async execute(_toolCallId, params) {
			try {
				const result = await queryZmallItems({
					keyword: params.keyword,
					category: params.category,
					pageNo: params.pageNo ?? 1,
					pageSize: params.pageSize ?? 20,
				});

				if ("error" in result) {
					return {
						content: [
							{
								type: "text",
								text: `${result.error}：${result.hint}`,
							},
						],
						details: result,
					};
				}

				return {
					content: [
						{
							type: "text",
							text: `查询成功：共 ${result.total} 件商品，当前第 ${params.pageNo ?? 1} 页，返回 ${result.items.length} 件。`,
						},
					],
					details: result,
				};
			} catch (err) {
				return {
					content: [
						{
							type: "text",
							text: `查询 ZMall 商品失败：${err instanceof Error ? err.message : "未知错误"}`,
						},
					],
					details: { error: "query_zmall_items failed" },
				};
			}
		},
	});

	// ===== Tool 4: generate_selection_report =====
	const generateSelectionReportTool = defineTool({
		name: "generate_selection_report",
		label: "Generate Selection Report",
		description:
			"Generate a structured Markdown selection report from market trend data, competitor analysis, and optional ZMall inventory. Includes trend overview, top products, price analysis, recommendations, and inventory analysis.",
		promptSnippet:
			"Use the generate_selection_report tool to compile a comprehensive Markdown selection report. Requires category, marketTrend (from fetch_market_trend), and competitorAnalysis (from analyze_competitors). Optionally include zmallInventory (from query_zmall_items).",
		parameters: Type.Object({
			category: Type.String({ description: "Product category for the report" }),
			marketTrend: Type.Unknown({
				description: "Output from fetch_market_trend tool (required)",
			}),
			competitorAnalysis: Type.Unknown({
				description: "Output from analyze_competitors tool (required)",
			}),
			zmallInventory: Type.Optional(
				Type.Unknown({ description: "Output from query_zmall_items tool (optional)" }),
			),
		}),
		async execute(_toolCallId, params) {
			try {
				const category = params.category;
				const marketTrend = params.marketTrend as MarketTrendData;
				const competitorAnalysis = params.competitorAnalysis as CompetitorAnalysis;
				const zmallInventory = params.zmallInventory as ZmallInventory | undefined;

				if (!marketTrend || !competitorAnalysis) {
					return {
						content: [
							{
								type: "text",
								text: "生成报告失败：marketTrend 和 competitorAnalysis 为必填参数。",
							},
						],
						details: { error: "missing required parameters" },
					};
				}

				const result = generateSelectionReportMarkdown(
					category,
					marketTrend,
					competitorAnalysis,
					zmallInventory,
				);

				return {
					content: [
						{
							type: "text",
							text: result.report,
						},
					],
					details: {
						report: result.report,
						summary: result.summary,
						generatedAt: result.generatedAt,
					},
				};
			} catch (err) {
				return {
					content: [
						{
							type: "text",
							text: `生成选品报告失败：${err instanceof Error ? err.message : "未知错误"}`,
						},
					],
					details: { error: "generate_selection_report failed" },
				};
			}
		},
	});

	pi.registerTool(fetchMarketTrendTool);
	pi.registerTool(analyzeCompetitorsTool);
	pi.registerTool(queryZmallItemsTool);
	pi.registerTool(generateSelectionReportTool);
}
