/**
 * AI Outfit Skill - AI 穿搭搭配能力
 *
 * 为前台工作台（customer/admin 角色）提供 AI 驱动的穿搭推荐工具：
 * 1. query_outfit        —— 根据风格/场景/颜色生成穿搭推荐
 * 2. regenerate_outfit   —— 基于用户反馈调整穿搭方案（"换一套"、"第二套的鞋子换掉"）
 *
 * 角色限制：仅 customer 和 admin 可用，merchant 不可见。
 *
 * 异步模型：
 * - 生成端点立即返回 { taskId, status: "PROCESSING" }
 * - 工具内部轮询 GET /api/v1/outfit/agent/result/{taskId} 直到 SUCCESS/FAILED
 * - 轮询间隔 2 秒，最多 15 次（30 秒）
 *
 * 认证：通过 ZMall 网关访问 ai-outfit 服务，使用缓存的 JWT token。
 * 网关验证 JWT 后注入 user-info header 转发给下游服务。
 */

import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { MallSkillConfig } from "../types.ts";
import { type ZmallResponse } from "./zmall-client.ts";
import { getCurrentPlatform } from "../index.ts";
import { ZMallAdapter } from "../platform/index.ts";

// ===== 常量 =====

const OUTFIT_API_PREFIX = "/api/v1/outfit/agent";
const DEFAULT_POLL_MAX_ATTEMPTS = 15;
const DEFAULT_POLL_INTERVAL_MS = 2000;
const SCENE_DESC_MAX_LENGTH = 50;
const NOTE_MAX_LENGTH = 50;
const FEEDBACK_MIN_LENGTH = 1;
const FEEDBACK_MAX_LENGTH = 200;
const OUTFIT_INDEX_MIN = 0;
const OUTFIT_INDEX_MAX = 2;
const ITEM_INDEX_MIN = 0;
const ITEM_INDEX_MAX = 5;

// ===== 类型定义 =====

/** 穿搭单品 */
interface OutfitItem {
	itemId: number;
	name: string;
	image: string;
	category: string;
	color: string;
	price: number;
	shopName: string;
	isMain?: boolean;
	score?: number;
	styleTags?: string[];
}

/** 穿搭方案 */
interface Outfit {
	items: OutfitItem[];
	resultUrl: string;
	reason: string;
	score: number;
	isVtonGenerated?: boolean;
}

/** 轮询结果响应 */
interface OutfitResultResponse {
	status: "PROCESSING" | "SUCCESS" | "FAILED";
	taskId: string;
	userId?: number;
	taskType?: string;
	stage?: string;
	outfits?: Outfit[];
	errorMsg?: string | null;
}

/** 生成推荐响应 */
interface TaskCreatedResponse {
	taskId: string;
	status: "PROCESSING";
	msg?: string;
}

// ===== 导出的辅助函数（供测试使用）=====

/** 等待指定毫秒数 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 调用 ai-outfit API（通过 ZMall 网关）。
 * 通过 ZMallAdapter 转发，复用 zmall-client.ts 的认证与重试逻辑（自动附加 JWT 并处理 401/429）。
 * @param path  - API 路径（如 /api/v1/outfit/agent/recommend）
 * @param method - HTTP 方法
 * @param body  - 请求体（可选）
 */
export async function callOutfitApi(
	path: string,
	method: string,
	body?: unknown,
): Promise<ZmallResponse> {
	const platform = getCurrentPlatform();
	if (!(platform instanceof ZMallAdapter)) {
		throw new Error(`AI outfit is only supported on ZMall platform. Current: ${platform.platformId}`);
	}
	return platform.callOutfitApi(path, method, body);
}

/**
 * 轮询穿搭任务结果，直到状态不再是 PROCESSING 或达到最大尝试次数。
 * @param taskId       - 任务 ID
 * @param maxAttempts  - 最大轮询次数（默认 15）
 * @param intervalMs   - 轮询间隔毫秒（默认 2000）
 * @param fetchResult  - 可选的自定义获取函数（供测试注入 mock）
 */
export async function pollOutfitResult(
	taskId: string,
	maxAttempts: number = DEFAULT_POLL_MAX_ATTEMPTS,
	intervalMs: number = DEFAULT_POLL_INTERVAL_MS,
	fetchResult?: (taskId: string) => Promise<OutfitResultResponse>,
): Promise<OutfitResultResponse> {
	const defaultFetch = async (tid: string): Promise<OutfitResultResponse> => {
		const response = await callOutfitApi(`${OUTFIT_API_PREFIX}/result/${tid}`, "GET");
		return response.data as OutfitResultResponse;
	};
	const fetcher = fetchResult ?? defaultFetch;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		if (attempt > 0) {
			await sleep(intervalMs);
		}
		const result = await fetcher(taskId);
		if (result.status !== "PROCESSING") {
			return result;
		}
	}

	// 超时：返回 PROCESSING 状态
	return { status: "PROCESSING", taskId };
}

/**
 * 格式化穿搭结果为工具返回的 details 结构。
 * 从原始 outfits 中提取关键字段，移除冗余信息。
 */
function formatOutfitResult(result: OutfitResultResponse): {
	taskId: string;
	status: string;
	outfits?: Array<{
		items: Array<{
			itemId: number;
			name: string;
			image: string;
			category: string;
			color: string;
			price: number;
			shopName: string;
			styleTags?: string[];
		}>;
		resultUrl: string;
		reason: string;
		score: number;
	}>;
	error?: string;
	message: string;
} {
	if (result.status === "SUCCESS") {
		const outfits = (result.outfits ?? []).map((o) => ({
			items: (o.items ?? []).map((item) => ({
				itemId: item.itemId,
				name: item.name,
				image: item.image,
				category: item.category,
				color: item.color,
				price: item.price,
				shopName: item.shopName,
				styleTags: item.styleTags,
			})),
			resultUrl: o.resultUrl,
			reason: o.reason,
			score: o.score,
		}));
		return {
			taskId: result.taskId,
			status: "SUCCESS",
			outfits,
			message: "搭配方案已生成",
		};
	}

	if (result.status === "FAILED") {
		return {
			taskId: result.taskId,
			status: "FAILED",
			error: result.errorMsg ?? "未知错误",
			message: "穿搭生成失败",
		};
	}

	// PROCESSING（超时）
	return {
		taskId: result.taskId,
		status: "PROCESSING",
		message: "穿搭正在生成中，请稍后查询结果",
	};
}

/**
 * 根据 HTTP 响应生成错误提示文本。
 */
function getErrorMessage(response: ZmallResponse): string {
	const status = response.status;
	const data = response.data as Record<string, unknown> | null;
	const serverMsg = data?.msg ?? data?.error ?? data?.message;

	if (status === 400) {
		return `参数校验失败${serverMsg ? `：${serverMsg}` : "，请检查输入参数"}`;
	}
	if (status === 403) {
		return `配额已用完或反馈轮次超限${serverMsg ? `：${serverMsg}` : "，请稍后再试"}`;
	}
	if (status === 404) {
		return `任务不存在${serverMsg ? `：${serverMsg}` : "，请确认 taskId 是否正确"}`;
	}
	if (status === 409) {
		return `任务已完成，无法再次反馈${serverMsg ? `：${serverMsg}` : ""}`;
	}
	if (status === 429) {
		return `请求过于频繁，请稍后再试`;
	}
	if (status === 401) {
		return `登录已过期，请重新登录后再试`;
	}
	if (status >= 500) {
		return "穿搭服务暂时繁忙，请稍后再试";
	}
	return `请求失败（HTTP ${status}）${serverMsg ? `：${serverMsg}` : ""}`;
}

// ===== Skill 配置 =====

/** ai-outfit skill 配置：仅 customer/admin 可用 */
export const aiOutfitSkillConfig: MallSkillConfig = {
	name: "ai-outfit",
	allowedRoles: ["customer", "admin"],
	toolNames: ["query_outfit", "regenerate_outfit"],
};

// ===== 工具注册 =====

/**
 * 注册 ai-outfit skill 到 agent。
 * 在 mall-skills 扩展入口中被调用。
 */
export function registerAiOutfitSkill(pi: ExtensionAPI): void {
	// ===== Tool 1: query_outfit =====
	const queryOutfitTool = defineTool({
		name: "query_outfit",
		label: "Query Outfit",
		description:
			"Generate AI-powered outfit recommendations based on style tags, preferred colors, scene description, or natural language notes. Polls the async result internally and returns the complete outfit plan. At least one of styleTags/colors/sceneDesc/note must be provided.",
		promptSnippet:
			"Use the query_outfit tool to generate outfit recommendations. Extract style (通勤/休闲/约会/运动/商务/街头/复古/欧美/亚洲), colors (Chinese names like 白色/蓝色), scene (面试/约会/通勤), and season from the user's natural language. At least one of styleTags/colors/sceneDesc/note is required. The tool handles async polling internally and returns the final result.",
		parameters: Type.Object({
			styleTags: Type.Optional(
				Type.Array(Type.String(), {
					description: "Style tags like [\"通勤\"], [\"休闲\"]. Options: 通勤/休闲/约会/运动/商务/街头/复古/欧美/亚洲",
				}),
			),
			colors: Type.Optional(
				Type.Array(Type.String(), {
					description: "Preferred colors in Chinese, e.g. [\"白色\", \"蓝色\"]",
				}),
			),
			sceneDesc: Type.Optional(
				Type.String({
					description: "Scene description (≤50 chars), e.g. \"下周面试\", \"周末约会\"",
				}),
			),
			note: Type.Optional(
				Type.String({
					description: "Natural language note about preferences (≤50 chars), e.g. \"想要休闲一点的\"",
				}),
			),
			gender: Type.Optional(
				Type.String({
					description: "Gender: \"male\" or \"female\"",
				}),
			),
			city: Type.Optional(
				Type.String({
					description: "User city for weather-based suggestions (default 北京)",
				}),
			),
		}),
		async execute(_toolCallId, params) {
			try {
				// 校验：至少一个输入参数
				const hasStyleTags = params.styleTags && params.styleTags.length > 0;
				const hasColors = params.colors && params.colors.length > 0;
				const hasSceneDesc = params.sceneDesc && params.sceneDesc.trim().length > 0;
				const hasNote = params.note && params.note.trim().length > 0;

				if (!hasStyleTags && !hasColors && !hasSceneDesc && !hasNote) {
					return {
						content: [
							{
								type: "text",
								text: "请至少提供以下参数之一：styleTags（风格标签）、colors（偏好颜色）、sceneDesc（场景描述）、note（自然语言备注）。",
							},
						],
						details: {
							status: "VALIDATION_ERROR",
							message: "至少需要一个输入参数",
						},
					};
				}

				// 构建请求体（仅包含非空字段）
				const requestBody: Record<string, unknown> = {};
				if (params.styleTags && params.styleTags.length > 0) {
					requestBody.styleTags = params.styleTags;
				}
				if (params.colors && params.colors.length > 0) {
					requestBody.color = params.colors;
				}
				if (params.sceneDesc && params.sceneDesc.trim().length > 0) {
					requestBody.sceneDesc = params.sceneDesc.trim();
				}
				if (params.note && params.note.trim().length > 0) {
					requestBody.note = params.note.trim();
				}
				if (params.gender) {
					requestBody.systemModelGender = params.gender;
				}
				if (params.city) {
					requestBody.userCity = params.city;
				}

				// 调用生成接口
				const response = await callOutfitApi(
					`${OUTFIT_API_PREFIX}/recommend`,
					"POST",
					requestBody,
				);

				if (!response.ok || !response.data) {
					return {
						content: [
							{
								type: "text",
								text: getErrorMessage(response),
							},
						],
						details: {
							status: "ERROR",
							httpStatus: response.status,
							message: getErrorMessage(response),
						},
					};
				}

				const createData = response.data as TaskCreatedResponse;
				const taskId = createData.taskId;

				if (!taskId) {
					return {
						content: [
							{
								type: "text",
								text: "穿搭生成请求已发送，但未返回任务 ID。",
							},
						],
						details: {
							status: "ERROR",
							message: "未返回 taskId",
							rawResponse: response.data,
						},
					};
				}

				// 轮询结果
				const result = await pollOutfitResult(taskId);
				const formatted = formatOutfitResult(result);

				let textMessage: string;
				if (formatted.status === "SUCCESS") {
					const outfitCount = formatted.outfits?.length ?? 0;
					textMessage = `搭配方案已生成（共 ${outfitCount} 套），任务 ID：${taskId}。`;
				} else if (formatted.status === "FAILED") {
					textMessage = `穿搭生成失败：${formatted.error ?? "未知错误"}（任务 ID：${taskId}）`;
				} else {
					textMessage = `穿搭正在生成中，请稍后查询结果（任务 ID：${taskId}）。`;
				}

				return {
					content: [{ type: "text", text: textMessage }],
					details: formatted,
				};
			} catch (err) {
				return {
					content: [
						{
							type: "text",
							text: `穿搭生成失败：${err instanceof Error ? err.message : "未知错误"}`,
						},
					],
					details: { status: "ERROR", message: "query_outfit failed" },
				};
			}
		},
	});

	// ===== Tool 2: regenerate_outfit =====
	const regenerateOutfitTool = defineTool({
		name: "regenerate_outfit",
		label: "Regenerate Outfit",
		description:
			"Adjust an existing outfit based on user feedback. Supports full regeneration (\"换一套\") or point replacement (\"第二套的鞋子换掉\"). Max 3 rounds (first generation + 2 feedbacks). Requires the original taskId from query_outfit.",
		promptSnippet:
			"Use the regenerate_outfit tool when the user wants to adjust a previous outfit. Requires taskId (from query_outfit) and feedback text. Supports full swap (\"换一套\"), color avoidance (dislikeColors in English like [\"black\",\"red\"]), and point replacement (specify outfitIndex 0-2 and itemIndex 0-5). Max 2 feedback rounds per original task.",
		parameters: Type.Object({
			taskId: Type.String({
				description: "Original task ID returned from query_outfit",
			}),
			feedback: Type.String({
				description: "Feedback text (1-200 chars), e.g. \"换一套\", \"不喜欢这个颜色\", \"第二套的鞋子换休闲点的\"",
			}),
			outfitIndex: Type.Optional(
				Type.Number({
					description: "Which outfit to adjust (0-2), for point replacement",
					minimum: 0,
					maximum: 2,
				}),
			),
			itemIndex: Type.Optional(
				Type.Number({
					description: "Which item to replace (0-5), for point replacement",
					minimum: 0,
					maximum: 5,
				}),
			),
			dislikeColors: Type.Optional(
				Type.Array(Type.String(), {
					description: "Colors to avoid, in English (e.g. [\"black\", \"red\"])",
				}),
			),
			wantStyleTags: Type.Optional(
				Type.Array(Type.String(), {
					description: "Desired new style tags (e.g. [\"休闲\"])",
				}),
			),
		}),
		async execute(_toolCallId, params) {
			try {
				// 校验 taskId
				if (!params.taskId || params.taskId.trim().length === 0) {
					return {
						content: [
							{
								type: "text",
								text: "请提供原始任务 ID（taskId），可从 query_outfit 的返回结果中获取。",
							},
						],
						details: {
							status: "VALIDATION_ERROR",
							message: "taskId 为必填参数",
						},
					};
				}

				// 校验 feedback
				if (!params.feedback || params.feedback.trim().length < FEEDBACK_MIN_LENGTH) {
					return {
						content: [
							{
								type: "text",
								text: "请提供反馈内容（feedback），如 \"换一套\"、\"不喜欢这个颜色\"。",
							},
						],
						details: {
							status: "VALIDATION_ERROR",
							message: "feedback 为必填参数",
						},
					};
				}
				if (params.feedback.length > FEEDBACK_MAX_LENGTH) {
					return {
						content: [
							{
								type: "text",
								text: `反馈内容过长（最多 ${FEEDBACK_MAX_LENGTH} 字），请精简后重试。`,
							},
						],
						details: {
							status: "VALIDATION_ERROR",
							message: `feedback 超过 ${FEEDBACK_MAX_LENGTH} 字`,
						},
					};
				}

				// 校验 outfitIndex / itemIndex 范围
				if (
					params.outfitIndex !== undefined &&
					(params.outfitIndex < OUTFIT_INDEX_MIN || params.outfitIndex > OUTFIT_INDEX_MAX)
				) {
					return {
						content: [
							{
								type: "text",
								text: `outfitIndex 范围应为 ${OUTFIT_INDEX_MIN}-${OUTFIT_INDEX_MAX}。`,
							},
						],
						details: {
							status: "VALIDATION_ERROR",
							message: "outfitIndex 超出范围",
						},
					};
				}
				if (
					params.itemIndex !== undefined &&
					(params.itemIndex < ITEM_INDEX_MIN || params.itemIndex > ITEM_INDEX_MAX)
				) {
					return {
						content: [
							{
								type: "text",
								text: `itemIndex 范围应为 ${ITEM_INDEX_MIN}-${ITEM_INDEX_MAX}。`,
							},
						],
						details: {
							status: "VALIDATION_ERROR",
							message: "itemIndex 超出范围",
						},
					};
				}

				// 构建请求体
				const requestBody: Record<string, unknown> = {
					taskId: params.taskId,
					feedback: params.feedback,
				};
				if (params.outfitIndex !== undefined) {
					requestBody.outfitIndex = params.outfitIndex;
				}
				if (params.itemIndex !== undefined) {
					requestBody.itemIndex = params.itemIndex;
				}
				if (params.dislikeColors && params.dislikeColors.length > 0) {
					requestBody.dislikeColors = params.dislikeColors;
				}
				if (params.wantStyleTags && params.wantStyleTags.length > 0) {
					requestBody.wantStyleTags = params.wantStyleTags;
				}

				// 调用反馈接口
				const response = await callOutfitApi(
					`${OUTFIT_API_PREFIX}/feedback`,
					"POST",
					requestBody,
				);

				if (!response.ok || !response.data) {
					return {
						content: [
							{
								type: "text",
								text: getErrorMessage(response),
							},
						],
						details: {
							status: "ERROR",
							httpStatus: response.status,
							message: getErrorMessage(response),
						},
					};
				}

				const createData = response.data as TaskCreatedResponse;
				const taskId = createData.taskId;

				if (!taskId) {
					return {
						content: [
							{
								type: "text",
								text: "反馈请求已发送，但未返回任务 ID。",
							},
						],
						details: {
							status: "ERROR",
							message: "未返回 taskId",
							rawResponse: response.data,
						},
					};
				}

				// 轮询结果
				const result = await pollOutfitResult(taskId);
				const formatted = formatOutfitResult(result);

				let textMessage: string;
				if (formatted.status === "SUCCESS") {
					const outfitCount = formatted.outfits?.length ?? 0;
					textMessage = `搭配方案已调整（共 ${outfitCount} 套），任务 ID：${taskId}。`;
				} else if (formatted.status === "FAILED") {
					textMessage = `穿搭调整失败：${formatted.error ?? "未知错误"}（任务 ID：${taskId}）`;
				} else {
					textMessage = `穿搭正在调整中，请稍后查询结果（任务 ID：${taskId}）。`;
				}

				return {
					content: [{ type: "text", text: textMessage }],
					details: formatted,
				};
			} catch (err) {
				return {
					content: [
						{
							type: "text",
							text: `穿搭调整失败：${err instanceof Error ? err.message : "未知错误"}`,
						},
					],
					details: { status: "ERROR", message: "regenerate_outfit failed" },
				};
			}
		},
	});

	pi.registerTool(queryOutfitTool);
	pi.registerTool(regenerateOutfitTool);
}
