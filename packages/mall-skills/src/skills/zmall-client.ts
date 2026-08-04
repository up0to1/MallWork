/**
 * ZMall Client Skill
 *
 * 提供 ZMall 电商平台的 API 客户端能力：
 * 1. zmall_login        —— 用户登录，获取 JWT token
 * 2. query_items        —— 分页/搜索查询商品列表
 * 3. query_item_detail  —— 查询单个商品详情（含 EAV 属性）
 *
 * 通过 Spring Cloud Gateway 访问 ZMall 后端服务。
 * Token 自动缓存到 ~/.mall-agent/credentials.json，支持 401 自动重登录。
 */

import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { MallSkillConfig } from "../types.ts";
import { getCurrentPlatform } from "../index.ts";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

// ===== 常量 =====

const DEFAULT_GATEWAY_URL = "http://localhost:8080";
const CREDENTIALS_DIR = ".mall-agent";
const CREDENTIALS_FILE = "credentials.json";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RATE_LIMIT_RETRIES = 3;

// ===== 类型定义 =====

/** 登录响应 */
export interface LoginResponse {
	token: string;
	userId: number;
	username: string;
	role: number;
	balance: number;
	phone: string;
}

/** 凭证缓存结构 */
export interface Credentials {
	token: string;
	userId: number;
	username: string;
	role: number;
	/**
	 * 登录密码（明文存储，用于 401 时自动重登录）。
	 * SECURITY CONCERN: 这是 MVP 实现，明文存储密码有安全风险。
	 * 生产环境应使用 refresh token 机制或 OAuth，不应存储明文密码。
	 */
	password: string;
	gatewayUrl: string;
	loginTime: number;
}

/** zmallRequest 返回结构 */
export interface ZmallResponse {
	ok: boolean;
	status: number;
	data: unknown;
}

// ===== 导出的工具函数（供测试使用）=====

/**
 * 分（cents）转元（yuan）。
 * ZMall 内部价格以分为单位存储，对外展示需转为元。
 */
export function centsToYuan(cents: number): number {
	return Math.round(cents) / 100;
}

/**
 * 元（yuan）转分（cents）。
 * 用户输入价格以元为单位，调用 API 需转为分。
 */
export function yuanToCents(yuan: number): number {
	return Math.round(yuan * 100);
}

/**
 * 获取凭证文件路径：~/.mall-agent/credentials.json
 */
export function getCredentialsFilePath(): string {
	const homeDir = os.homedir();
	return path.join(homeDir, CREDENTIALS_DIR, CREDENTIALS_FILE);
}

/**
 * 获取当前 gateway URL（从环境变量读取，默认 http://localhost:8080）
 */
export function getGatewayUrl(): string {
	return process.env.ZMALL_GATEWAY_URL ?? DEFAULT_GATEWAY_URL;
}

/**
 * 构建搜索请求路径（/search/list?...）。
 * minPrice/maxPrice 接受元，内部转为分。
 */
export function buildSearchPath(params: {
	pageNo?: number;
	pageSize?: number;
	keyword?: string;
	category?: string;
	minPrice?: number; // yuan
	maxPrice?: number; // yuan
}): string {
	const searchParams = new URLSearchParams();
	if (params.pageNo !== undefined) {
		searchParams.set("pageNo", String(params.pageNo));
	}
	if (params.pageSize !== undefined) {
		searchParams.set("pageSize", String(params.pageSize));
	}
	if (params.keyword !== undefined && params.keyword !== "") {
		searchParams.set("key", params.keyword);
	}
	if (params.category !== undefined && params.category !== "") {
		searchParams.set("category", params.category);
	}
	if (params.minPrice !== undefined) {
		searchParams.set("minPrice", String(yuanToCents(params.minPrice)));
	}
	if (params.maxPrice !== undefined) {
		searchParams.set("maxPrice", String(yuanToCents(params.maxPrice)));
	}
	const query = searchParams.toString();
	return query ? `/search/list?${query}` : "/search/list";
}

/**
 * 构建搜索请求完整 URL。
 */
export function buildSearchUrl(
	gatewayUrl: string,
	params: {
		pageNo?: number;
		pageSize?: number;
		keyword?: string;
		category?: string;
		minPrice?: number;
		maxPrice?: number;
	},
): string {
	return new URL(buildSearchPath(params), gatewayUrl).toString();
}

/**
 * 构建商品详情请求路径（/items/{id}）。
 */
export function buildItemDetailPath(itemId: number): string {
	return `/items/${itemId}`;
}

// ===== 内部辅助函数 =====

/** 读取缓存的凭证 */
export async function loadCredentials(): Promise<Credentials | null> {
	try {
		const filePath = getCredentialsFilePath();
		const content = await fs.readFile(filePath, "utf-8");
		return JSON.parse(content) as Credentials;
	} catch {
		return null;
	}
}

/** 保存凭证到文件 */
export async function saveCredentials(creds: Credentials): Promise<void> {
	const filePath = getCredentialsFilePath();
	const dir = path.dirname(filePath);
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(filePath, JSON.stringify(creds, null, 2), "utf-8");
}

/** 等待指定毫秒数 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * ZMall HTTP 请求封装。
 * - 自动附加 Authorization: Bearer <token>
 * - 401 → 自动重登录（如有缓存凭证）→ 重试一次
 * - 429 → 指数退避重试（1s, 2s, 4s，最多 3 次）
 * - 超时：10 秒
 */
export async function zmallRequest(
	method: string,
	requestPath: string,
	options: {
		gatewayUrl?: string;
		body?: unknown;
		headers?: Record<string, string>;
		/** 跳过自动重登录（防止递归） */
		_skipRelogin?: boolean;
	} = {},
): Promise<ZmallResponse> {
	const gatewayUrl = options.gatewayUrl ?? getGatewayUrl();
	const url = new URL(requestPath, gatewayUrl).toString();

	const makeRequest = async (): Promise<ZmallResponse> => {
		const creds = await loadCredentials();
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			...options.headers,
		};
		if (creds?.token) {
			headers.Authorization = `Bearer ${creds.token}`;
		}

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

		try {
			const response = await fetch(url, {
				method,
				headers,
				body: options.body ? JSON.stringify(options.body) : undefined,
				signal: controller.signal,
			});
			const data = await response.json().catch(() => null);
			return { ok: response.ok, status: response.status, data };
		} catch (err) {
			return {
				ok: false,
				status: 0,
				data: { error: err instanceof Error ? err.message : "request failed" },
			};
		} finally {
			clearTimeout(timeout);
		}
	};

	// 429 指数退避重试
	for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
		const result = await makeRequest();

		if (result.status === 429) {
			if (attempt < MAX_RATE_LIMIT_RETRIES) {
				await sleep(1000 * 2 ** attempt);
				continue;
			}
			return result;
		}

		// 401 自动重登录（仅在非登录请求且有缓存凭证时）
		if (
			result.status === 401 &&
			!options._skipRelogin &&
			!requestPath.startsWith("/users/login")
		) {
			const creds = await loadCredentials();
			if (creds?.username && creds?.password) {
				const loginResult = await zmallRequest("POST", "/users/login", {
					gatewayUrl,
					body: { username: creds.username, password: creds.password },
					_skipRelogin: true,
				});
				if (loginResult.ok && loginResult.data) {
					const loginData = loginResult.data as LoginResponse;
					await saveCredentials({
						token: loginData.token,
						userId: loginData.userId,
						username: loginData.username,
						role: loginData.role,
						password: creds.password,
						gatewayUrl,
						loginTime: Date.now(),
					});
					// 重试原请求一次
					return zmallRequest(method, requestPath, {
						...options,
						_skipRelogin: true,
					});
				}
			}
		}

		return result;
	}

	// 理论上不会执行到这里
	return { ok: false, status: 429, data: { error: "rate limit exceeded" } };
}

// ===== Skill 配置 =====

/** zmall-client skill 配置：所有角色可用 */
export const zmallSkillConfig: MallSkillConfig = {
	name: "zmall-client",
	allowedRoles: ["customer", "merchant", "admin"],
	toolNames: ["zmall_login", "query_items", "query_item_detail"],
};

// ===== 工具注册 =====

/**
 * 注册 ZMall client skill 到 agent。
 * 在 mall-skills 扩展入口中被调用。
 */
export function registerZmallClientSkill(pi: ExtensionAPI): void {
	// ===== Tool 1: zmall_login =====
	const loginTool = defineTool({
		name: "zmall_login",
		label: "ZMall Login",
		description:
			"Login to ZMall with username and password. Caches the JWT token for subsequent authenticated API calls.",
		promptSnippet:
			"Use the zmall_login tool to authenticate with ZMall. Requires username and password. The token is cached automatically for subsequent requests.",
		parameters: Type.Object({
			username: Type.String({ description: "ZMall account username" }),
			password: Type.String({ description: "ZMall account password" }),
		}),
		async execute(_toolCallId, params) {
			try {
				const platform = getCurrentPlatform();
				const result = await platform.login(params.username, params.password);

				if (!result.success) {
					return {
						content: [{ type: "text", text: result.message }],
						details: { success: false },
					};
				}

				return {
					content: [
						{ type: "text", text: `Login successful. Welcome, ${result.username}!` },
					],
					details: {
						success: true,
						userId: result.userId,
						username: result.username,
						role: result.role,
						message: result.message,
					},
				};
			} catch {
				return {
					content: [{ type: "text", text: "Login failed due to a network error." }],
					details: { success: false },
				};
			}
		},
	});

	// ===== Tool 2: query_items =====
	const queryItemsTool = defineTool({
		name: "query_items",
		label: "Query Items",
		description:
			"Query ZMall product list with pagination and optional filters (keyword, category, price range). Prices are input/output in yuan.",
		promptSnippet:
			"Use the query_items tool to search ZMall products. Supports keyword search, category filter, and price range (in yuan). Returns paginated results with prices converted to yuan.",
		parameters: Type.Object({
			pageNo: Type.Optional(
				Type.Number({ description: "Page number, starting from 1", minimum: 1 }),
			),
			pageSize: Type.Optional(
				Type.Number({ description: "Items per page", minimum: 1, maximum: 100 }),
			),
			keyword: Type.Optional(Type.String({ description: "Search keyword" })),
			category: Type.Optional(Type.String({ description: "Category name (e.g. 上衣)" })),
			minPrice: Type.Optional(
				Type.Number({ description: "Minimum price in yuan", minimum: 0 }),
			),
			maxPrice: Type.Optional(
				Type.Number({ description: "Maximum price in yuan", minimum: 0 }),
			),
		}),
		async execute(_toolCallId, params) {
			try {
				const platform = getCurrentPlatform();
				const result = await platform.queryItems({
					pageNo: params.pageNo,
					pageSize: params.pageSize,
					keyword: params.keyword,
					category: params.category,
					minPrice: params.minPrice,
					maxPrice: params.maxPrice,
				});

				return {
					content: [
						{
							type: "text",
							text: `Found ${result.total} items (page ${params.pageNo ?? 1} of ${result.pages}).`,
						},
					],
					details: {
						success: true,
						total: result.total,
						pages: result.pages,
						items: result.items,
						message: "Query successful",
					},
				};
			} catch {
				return {
					content: [
						{ type: "text", text: "Failed to query items due to a network error." },
					],
					details: { success: false },
				};
			}
		},
	});

	// ===== Tool 3: query_item_detail =====
	const queryItemDetailTool = defineTool({
		name: "query_item_detail",
		label: "Query Item Detail",
		description:
			"Query detailed information for a single ZMall product by ID, including EAV attributes (color, season, styleTags, sizes, material).",
		promptSnippet:
			"Use the query_item_detail tool to get full details of a specific product by its ID. Returns price in yuan and all EAV attributes.",
		parameters: Type.Object({
			itemId: Type.Number({ description: "The product ID", minimum: 1 }),
		}),
		async execute(_toolCallId, params) {
			try {
				const platform = getCurrentPlatform();
				const item = await platform.getItemDetail(params.itemId);

				if (!item) {
					return {
						content: [
							{ type: "text", text: `Failed to query item ${params.itemId}.` },
						],
						details: { success: false },
					};
				}

				return {
					content: [
						{
							type: "text",
							text: `Item detail for ID ${params.itemId}: ${item.name ?? "Unknown"}`,
						},
					],
					details: {
						success: true,
						item,
						message: "Query successful",
					},
				};
			} catch {
				return {
					content: [
						{ type: "text", text: "Failed to query item detail due to a network error." },
					],
					details: { success: false },
				};
			}
		},
	});

	pi.registerTool(loginTool);
	pi.registerTool(queryItemsTool);
	pi.registerTool(queryItemDetailTool);
}
