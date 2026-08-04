/**
 * ZMall 平台适配器
 *
 * 将现有 ZMall HTTP API 逻辑包装为 EcommercePlatform 接口实现。
 * - 复用 zmall-client.ts 中的 zmallRequest、价格转换、凭证缓存等逻辑
 * - 401 自动重登录、429 指数退避由 zmallRequest 内部处理
 * - 额外暴露 callOutfitApi 供 ai-outfit skill 使用（非接口方法）
 */

import type {
	EcommercePlatform,
	PlatformAuthResult,
	ItemQueryFilter,
	ItemQueryResult,
	PlatformItem,
} from "../types.ts";
import { registerPlatform } from "../registry.ts";
import {
	zmallRequest,
	getGatewayUrl,
	centsToYuan,
	buildSearchPath,
	buildItemDetailPath,
	saveCredentials,
	type LoginResponse,
	type Credentials,
	type ZmallResponse,
} from "../../skills/zmall-client.ts";

/** ZMall 搜索接口返回的列表项结构 */
interface ZmallListItem {
	id: number;
	name: string;
	price: number;
	image: string;
	category: string;
	sold?: number;
	stock: number;
	brand?: string;
	status?: number;
}

/** ZMall 搜索接口返回结构 */
interface ZmallSearchResponse {
	total?: number;
	pages?: number;
	list?: ZmallListItem[];
}

/** ZMall 商品详情接口返回结构（含 EAV 属性） */
interface ZmallItemDetail {
	id: number;
	name: string;
	price: number;
	stock: number;
	image: string;
	category: string;
	brand?: string;
	sold?: number;
	status?: number;
	description?: string;
	color?: string;
	season?: string;
	styleTags?: string[];
	sizes?: string[];
	material?: string;
}

export class ZMallAdapter implements EcommercePlatform {
	readonly platformId = "zmall";
	readonly displayName = "ZMall";

	async login(username: string, password: string): Promise<PlatformAuthResult> {
		const gatewayUrl = getGatewayUrl();
		const result = await zmallRequest("POST", "/users/login", {
			gatewayUrl,
			body: { username, password },
		});

		if (!result.ok || !result.data) {
			return {
				success: false,
				message: "Login failed. Please check your credentials.",
			};
		}

		const loginData = result.data as LoginResponse;
		const creds: Credentials = {
			token: loginData.token,
			userId: loginData.userId,
			username: loginData.username,
			role: loginData.role,
			password,
			gatewayUrl,
			loginTime: Date.now(),
		};
		await saveCredentials(creds);

		return {
			success: true,
			userId: loginData.userId,
			username: loginData.username,
			role: loginData.role,
			token: loginData.token,
			message: "Login successful",
		};
	}

	async queryItems(filter: ItemQueryFilter): Promise<ItemQueryResult> {
		const gatewayUrl = getGatewayUrl();
		const searchPath = buildSearchPath({
			pageNo: filter.pageNo ?? 1,
			pageSize: filter.pageSize ?? 20,
			keyword: filter.keyword,
			category: filter.category,
			minPrice: filter.minPrice,
			maxPrice: filter.maxPrice,
		});

		const result = await zmallRequest("GET", searchPath, { gatewayUrl });

		if (!result.ok || !result.data) {
			return { total: 0, pages: 0, items: [] };
		}

		const data = result.data as ZmallSearchResponse;
		const items: PlatformItem[] = (data.list ?? []).map((item) => ({
			id: item.id,
			name: item.name,
			price: centsToYuan(Number(item.price) || 0),
			image: item.image,
			category: item.category,
			sold: item.sold,
			stock: item.stock,
			brand: item.brand,
			status: item.status,
		}));

		return {
			total: data.total ?? 0,
			pages: data.pages ?? 0,
			items,
		};
	}

	async getItemDetail(itemId: number): Promise<PlatformItem | null> {
		const gatewayUrl = getGatewayUrl();
		const result = await zmallRequest("GET", buildItemDetailPath(itemId), {
			gatewayUrl,
		});

		if (!result.ok || !result.data) {
			return null;
		}

		const item = result.data as ZmallItemDetail;
		return {
			id: item.id,
			name: item.name,
			price: centsToYuan(Number(item.price) || 0),
			stock: item.stock,
			image: item.image,
			category: item.category,
			brand: item.brand,
			sold: item.sold,
			status: item.status,
			description: item.description,
			color: item.color,
			season: item.season,
			styleTags: item.styleTags,
			sizes: item.sizes,
			material: item.material,
		};
	}

	/**
	 * ZMall 专属方法（不属于 EcommercePlatform 接口）。
	 * 供 ai-outfit skill 调用 /api/v1/outfit/agent/* 端点。
	 */
	async callOutfitApi(path: string, method: string, body?: unknown): Promise<ZmallResponse> {
		const result = await zmallRequest(method, path, { body });
		return result;
	}
}

// 注册适配器
registerPlatform(new ZMallAdapter());
