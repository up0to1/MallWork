/**
 * 电商平台适配器接口
 * 每个平台（ZMall、Shopify、Amazon）实现此接口，屏蔽 API 差异
 */
export interface EcommercePlatform {
	readonly platformId: string;
	readonly displayName: string;

	login(username: string, password: string): Promise<PlatformAuthResult>;
	queryItems(filter: ItemQueryFilter): Promise<ItemQueryResult>;
	getItemDetail(itemId: number): Promise<PlatformItem | null>;
}

export interface PlatformAuthResult {
	success: boolean;
	userId?: number;
	username?: string;
	role?: number;
	token?: string;
	message: string;
}

export interface ItemQueryFilter {
	pageNo?: number;
	pageSize?: number;
	keyword?: string;
	category?: string;
	minPrice?: number;
	maxPrice?: number;
}

export interface ItemQueryResult {
	total: number;
	pages: number;
	items: PlatformItem[];
}

export interface PlatformItem {
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
