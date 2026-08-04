/**
 * Echo Skill - 最简验证 skill
 *
 * 提供一个 echo 工具，原样返回输入文本。用于验证：
 * 1. mall-skills 包能被 coding-agent 加载
 * 2. 工具注册机制工作正常
 * 3. promptSnippet 能注入到 system prompt
 */

import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { MallSkillConfig } from "../types.ts";

/** echo skill 配置：所有角色可用（验证阶段不限制） */
export const echoSkillConfig: MallSkillConfig = {
	name: "echo",
	allowedRoles: ["customer", "merchant", "admin"],
	toolNames: ["echo"],
};

/**
 * 注册 echo skill 到 agent。
 * 在 mall-skills 扩展入口中被调用。
 */
export function registerEchoSkill(pi: ExtensionAPI): void {
	const echoTool = defineTool({
		name: "echo",
		label: "Echo",
		description:
			"Echo back the input message exactly as received. Use this when the user wants to test tool invocation or see a message repeated.",
		promptSnippet:
			"Use the echo tool to repeat back any text the user asks you to echo. The tool returns the input verbatim.",
		parameters: Type.Object({
			message: Type.String({ description: "The message to echo back" }),
		}),
		async execute(_toolCallId, params) {
			return {
				content: [{ type: "text", text: params.message }],
				details: { echoed: true, length: params.message.length },
			};
		},
	});

	pi.registerTool(echoTool);
}
