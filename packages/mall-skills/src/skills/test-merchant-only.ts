/**
 * Test Merchant-Only Skill
 *
 * 仅允许 merchant 角色使用的测试 skill。
 * 用于验证角色白名单过滤：--role merchant 时可见，--role customer 时不可见。
 */

import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { MallSkillConfig } from "../types.ts";

export const testMerchantOnlyConfig: MallSkillConfig = {
	name: "test-merchant-only",
	allowedRoles: ["merchant"],
	toolNames: ["test_merchant_only"],
};

export function registerTestMerchantOnlySkill(pi: ExtensionAPI): void {
	const tool = defineTool({
		name: "test_merchant_only",
		label: "Test Merchant Only",
		description: "A test tool only available to the merchant role. Returns a confirmation message.",
		parameters: Type.Object({}),
		async execute() {
			return {
				content: [{ type: "text", text: "Merchant-only tool executed successfully." }],
				details: { role: "merchant", skill: "test-merchant-only" },
			};
		},
	});

	pi.registerTool(tool);
}
