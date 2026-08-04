export type {
	EcommercePlatform,
	PlatformAuthResult,
	ItemQueryFilter,
	ItemQueryResult,
	PlatformItem,
} from "./types.ts";

export {
	registerPlatform,
	getPlatform,
	listPlatformIds,
	clearPlatforms,
} from "./registry.ts";

export { ZMallAdapter } from "./adapters/zmall.ts";

// 侧效导入：确保 ZMallAdapter 被加载并注册到 platform registry
import "./adapters/zmall.ts";
