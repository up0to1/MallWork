/**
 * Mall Skills 扩展入口
 *
 * 作为 coding-agent 的内置扩展加载，注册所有电商 skill 并实现角色权限隔离。
 *
 * 核心机制：
 * 1. registerFlag("role") 注册 --role CLI 参数（默认 customer）
 * 2. 注册所有 skill 的工具（注册不受角色影响）
 * 3. session_start 时按角色过滤工具白名单（setActiveTools）
 * 4. tool_call 事件做防御性拦截（defense in depth）
 * 5. before_agent_start 注入角色上下文
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_ROLE, ALL_ROLES, type Role, type MallSkillConfig } from "./types.ts";
import { registerEchoSkill, echoSkillConfig } from "./skills/echo.ts";
import { registerTestCustomerOnlySkill, testCustomerOnlyConfig } from "./skills/test-customer-only.ts";
import { registerTestMerchantOnlySkill, testMerchantOnlyConfig } from "./skills/test-merchant-only.ts";
import { registerZmallClientSkill, zmallSkillConfig } from "./skills/zmall-client.ts";
import { registerProductResearchSkill, productResearchSkillConfig } from "./skills/product-research.ts";
import { registerAiOutfitSkill, aiOutfitSkillConfig } from "./skills/ai-outfit.ts";
import { getPlatform, listPlatformIds, type EcommercePlatform } from "./platform/index.ts";

const DEFAULT_PLATFORM = "zmall";

let currentPlatform: EcommercePlatform | null = null;

/** 所有 mall-skills 的配置注册表 */
const skillRegistry: readonly MallSkillConfig[] = [
	echoSkillConfig,
	testCustomerOnlyConfig,
	testMerchantOnlyConfig,
	zmallSkillConfig,
	productResearchSkillConfig,
	aiOutfitSkillConfig,
];

/** 构建 toolName → allowedRoles 映射，用于角色过滤 */
export function buildToolPermissionMap(): Map<string, readonly Role[]> {
	const map = new Map<string, readonly Role[]>();
	for (const skill of skillRegistry) {
		for (const toolName of skill.toolNames) {
			map.set(toolName, skill.allowedRoles);
		}
	}
	return map;
}

/** 解析角色 flag，校验有效性 */
export function resolveRole(raw: boolean | string | undefined): Role {
	if (typeof raw === "string" && (ALL_ROLES as readonly string[]).includes(raw)) {
		return raw as Role;
	}
	return DEFAULT_ROLE;
}

/** 解析 platform flag，校验有效性 */
export function resolvePlatform(value: unknown): string {
	if (typeof value === "string" && value.length > 0) {
		return value;
	}
	return DEFAULT_PLATFORM;
}

/** 获取当前已初始化的平台适配器（session_start 之后可用） */
export function getCurrentPlatform(): EcommercePlatform {
	if (!currentPlatform) {
		throw new Error("No platform initialized. Call this after session_start.");
	}
	return currentPlatform;
}

/** 判断角色是否允许使用某工具（非 mall-skills 工具默认放行） */
export function isToolAllowed(toolName: string, role: Role, permissionMap: Map<string, readonly Role[]>): boolean {
	const allowedRoles = permissionMap.get(toolName);
	if (allowedRoles === undefined) {
		return true;
	}
	return allowedRoles.includes(role);
}

export default function mallSkillsExtension(pi: ExtensionAPI): void {
	// ===== 1. 注册 --role CLI 参数 =====
	pi.registerFlag("role", {
		description: "Agent role: customer (default), merchant, or admin. Controls which skills are available.",
		type: "string",
		default: DEFAULT_ROLE,
	});

	pi.registerFlag("platform", {
		description: "E-commerce platform: zmall (default), shopify, amazon. Controls which platform adapter is used.",
		type: "string",
		default: DEFAULT_PLATFORM,
	});

	// ===== 2. 注册所有 skill 的工具 =====
	registerEchoSkill(pi);
	registerTestCustomerOnlySkill(pi);
	registerTestMerchantOnlySkill(pi);
	registerZmallClientSkill(pi);
	registerProductResearchSkill(pi);
	registerAiOutfitSkill(pi);

	const toolPermissionMap = buildToolPermissionMap();
	let currentRole: Role = DEFAULT_ROLE;

	// ===== 3. session_start: 按角色过滤工具白名单 =====
	pi.on("session_start", () => {
		currentRole = resolveRole(pi.getFlag("role"));

		// Resolve platform
		const platformId = resolvePlatform(pi.getFlag("platform"));
		try {
			currentPlatform = getPlatform(platformId);
		} catch (error) {
			console.error(`Failed to initialize platform: ${error instanceof Error ? error.message : String(error)}`);
			process.exit(1);
		}

		const activeTools = pi.getActiveTools();
		const filteredTools = activeTools.filter(
			(name) => isToolAllowed(name, currentRole, toolPermissionMap),
		);

		const disabledTools = activeTools.filter(
			(name) => !isToolAllowed(name, currentRole, toolPermissionMap),
		);

		if (disabledTools.length > 0) {
			pi.setActiveTools(filteredTools);
		}
	});

	// ===== 4. tool_call: 防御性拦截（defense in depth） =====
	pi.on("tool_call", (event) => {
		if (!isToolAllowed(event.toolName, currentRole, toolPermissionMap)) {
			return {
				block: true,
				reason: `Role "${currentRole}" is not allowed to use tool "${event.toolName}". This tool belongs to a skill restricted to other roles.`,
			};
		}
	});

	// ===== 5. before_agent_start: 注入角色上下文 =====
	pi.on("before_agent_start", () => {
		const platformInfo = currentPlatform
			? `Current platform: ${currentPlatform.displayName} (${currentPlatform.platformId})`
			: "No platform initialized";

		return {
			message: {
				customType: "mall-role-context",
				content: `[MALL AGENT ROLE: ${currentRole.toUpperCase()}]
You are operating as a "${currentRole}" role in the Mall Work e-commerce agent.

${platformInfo}

Role descriptions:
- customer: front-end user (AI outfit, customer service, product recommendations)
- merchant: back-end operator (product research, inventory, pricing, SEO)
- admin: platform administrator (all capabilities)

Only tools available to your role are enabled. Do not attempt to access tools outside your role.`,
				display: false,
			},
		};
	});
}
