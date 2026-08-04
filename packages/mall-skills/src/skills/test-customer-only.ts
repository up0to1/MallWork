/**
 * Test Customer-Only Skill
 *
 * 仅允许 customer 角色使用的测试 skill。
 * 用于验证角色白名单过滤：--role customer 时可见，--role merchant 时不可见。
 */

import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { MallSkillConfig } from "../types.ts";

export const testCustomerOnlyConfig: MallSkillConfig = {
	name: "test-customer-only",
	allowedRoles: ["customer"],
	toolNames: ["test_customer_only"],
};

export function registerTestCustomerOnlySkill(pi: ExtensionAPI): void {
	const tool = defineTool({
		name: "test_customer_only",
		label: "Test Customer Only",
		description: "A test tool only available to the customer role. Returns a confirmation message.",
		parameters: Type.Object({}),
		async execute() {
			return {
				content: [{ type: "text", text: "Customer-only tool executed successfully." }],
				details: { role: "customer", skill: "test-customer-only" },
			};
		},
	});

	pi.registerTool(tool);
}
