/**
 * ZMall Client Skill 验证脚本
 *
 * 不依赖 LLM，也不依赖运行中的 ZMall 服务器，直接验证：
 *   1. zmallSkillConfig 配置结构（allowedRoles, toolNames）
 *   2. 价格转换逻辑（centsToYuan / yuanToCents）
 *   3. URL 构建逻辑（buildSearchPath / buildSearchUrl / buildItemDetailPath）
 *   4. 凭证文件路径解析（getCredentialsFilePath）
 *   5. 工具注册（mock pi 对象，验证 3 个工具被正确注册）
 *
 * 运行方式（从 monorepo 根目录）：
 *   node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json \
 *     packages/mall-skills/test/verify-zmall-client.ts
 */

import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { buildToolPermissionMap, isToolAllowed } from "../src/index.ts";
import {
	registerZmallClientSkill,
	zmallSkillConfig,
	centsToYuan,
	yuanToCents,
	buildSearchPath,
	buildSearchUrl,
	buildItemDetailPath,
	getCredentialsFilePath,
	getGatewayUrl,
} from "../src/skills/zmall-client.ts";
import path from "node:path";
import os from "node:os";

// ===== 简易测试框架 =====
let passCount = 0;
let failCount = 0;

function check(label: string, condition: boolean, detail?: string): void {
	if (condition) {
		passCount++;
		console.log(`  ✓ ${label}`);
	} else {
		failCount++;
		console.error(`  ✗ ${label}${detail ? ` —— ${detail}` : ""}`);
	}
}

function section(title: string): void {
	console.log(`\n===== ${title} =====`);
}

// ===== Mock ExtensionAPI =====
const registeredTools: Map<string, ToolDefinition> = new Map();

const mockPi: Pick<ExtensionAPI, "registerTool"> = {
	registerTool(tool: ToolDefinition) {
		registeredTools.set(tool.name, tool);
	},
};

// ===== 测试 1：zmallSkillConfig 配置结构 =====
section("测试 1：zmallSkillConfig 配置结构");

check(
	'skill name === "zmall-client"',
	zmallSkillConfig.name === "zmall-client",
	`实际：${zmallSkillConfig.name}`,
);
check(
	"allowedRoles 包含 3 个角色",
	zmallSkillConfig.allowedRoles.length === 3,
	`实际长度：${zmallSkillConfig.allowedRoles.length}`,
);
check(
	'allowedRoles 包含 "customer"',
	zmallSkillConfig.allowedRoles.includes("customer"),
);
check(
	'allowedRoles 包含 "merchant"',
	zmallSkillConfig.allowedRoles.includes("merchant"),
);
check(
	'allowedRoles 包含 "admin"',
	zmallSkillConfig.allowedRoles.includes("admin"),
);
check(
	"toolNames 包含 3 个工具",
	zmallSkillConfig.toolNames.length === 3,
	`实际长度：${zmallSkillConfig.toolNames.length}`,
);
check(
	'toolNames 包含 "zmall_login"',
	zmallSkillConfig.toolNames.includes("zmall_login"),
);
check(
	'toolNames 包含 "query_items"',
	zmallSkillConfig.toolNames.includes("query_items"),
);
check(
	'toolNames 包含 "query_item_detail"',
	zmallSkillConfig.toolNames.includes("query_item_detail"),
);

// ===== 测试 2：价格转换 centsToYuan =====
section("测试 2：价格转换 centsToYuan");

check(
	"centsToYuan(0) === 0",
	centsToYuan(0) === 0,
);
check(
	"centsToYuan(100) === 1",
	centsToYuan(100) === 1,
);
check(
	"centsToYuan(999) === 9.99",
	centsToYuan(999) === 9.99,
);
check(
	"centsToYuan(123456) === 1234.56",
	centsToYuan(123456) === 1234.56,
);
check(
	"centsToYuan(50) === 0.5",
	centsToYuan(50) === 0.5,
);
check(
	"centsToYuan(1) === 0.01",
	centsToYuan(1) === 0.01,
);

// ===== 测试 3：价格转换 yuanToCents =====
section("测试 3：价格转换 yuanToCents");

check(
	"yuanToCents(0) === 0",
	yuanToCents(0) === 0,
);
check(
	"yuanToCents(1) === 100",
	yuanToCents(1) === 100,
);
check(
	"yuanToCents(9.99) === 999",
	yuanToCents(9.99) === 999,
);
check(
	"yuanToCents(1234.56) === 123456",
	yuanToCents(1234.56) === 123456,
);
check(
	"yuanToCents(0.5) === 50",
	yuanToCents(0.5) === 50,
);
check(
	"yuanToCents(0.01) === 1",
	yuanToCents(0.01) === 1,
);

// ===== 测试 4：round-trip 转换一致性 =====
section("测试 4：round-trip 转换一致性");

const testPrices = [0, 1, 9.99, 100, 1234.56, 0.5, 99.99];
for (const yuan of testPrices) {
	const cents = yuanToCents(yuan);
	const back = centsToYuan(cents);
	check(
		`yuanToCents(${yuan}) → centsToYuan → ${back} 一致`,
		Math.abs(back - yuan) < 0.0001,
		`实际：${back}`,
	);
}

// ===== 测试 5：buildSearchPath URL 构建 =====
section("测试 5：buildSearchPath URL 构建");

// 空参数
const emptyPath = buildSearchPath({});
check(
	"空参数路径为 /search/list",
	emptyPath === "/search/list",
	`实际：${emptyPath}`,
);

// 仅分页参数
const pagePath = buildSearchPath({ pageNo: 1, pageSize: 20 });
check(
	"分页路径包含 pageNo=1",
	pagePath.includes("pageNo=1"),
	`实际：${pagePath}`,
);
check(
	"分页路径包含 pageSize=20",
	pagePath.includes("pageSize=20"),
	`实际：${pagePath}`,
);
check(
	"分页路径以 /search/list 开头",
	pagePath.startsWith("/search/list?"),
	`实际：${pagePath}`,
);

// 关键词搜索
const keywordPath = buildSearchPath({ pageNo: 1, pageSize: 20, keyword: "手机" });
check(
	'关键词映射为 key 参数',
	keywordPath.includes("key="),
	`实际：${keywordPath}`,
);

// 价格范围（元 → 分转换）
const pricePath = buildSearchPath({
	pageNo: 1,
	pageSize: 20,
	minPrice: 100,
	maxPrice: 5000,
});
check(
	"minPrice 100 元 → 10000 分",
	pricePath.includes("minPrice=10000"),
	`实际：${pricePath}`,
);
check(
	"maxPrice 5000 元 → 500000 分",
	pricePath.includes("maxPrice=500000"),
	`实际：${pricePath}`,
);

// 小数价格
const decimalPricePath = buildSearchPath({ minPrice: 9.99, maxPrice: 19.5 });
check(
	"minPrice 9.99 元 → 999 分",
	decimalPricePath.includes("minPrice=999"),
	`实际：${decimalPricePath}`,
);
check(
	"maxPrice 19.5 元 → 1950 分",
	decimalPricePath.includes("maxPrice=1950"),
	`实际：${decimalPricePath}`,
);

// 空字符串关键词应被忽略
const emptyKeywordPath = buildSearchPath({ keyword: "" });
check(
	"空字符串关键词被忽略",
	!emptyKeywordPath.includes("key="),
	`实际：${emptyKeywordPath}`,
);

// 分类参数
const categoryPath = buildSearchPath({ category: "上衣" });
check(
	"分类参数正确添加",
	categoryPath.includes("category="),
	`实际：${categoryPath}`,
);

// ===== 测试 6：buildSearchUrl 完整 URL 构建 =====
section("测试 6：buildSearchUrl 完整 URL 构建");

const fullUrl = buildSearchUrl("http://localhost:8080", {
	pageNo: 1,
	pageSize: 20,
	keyword: "test",
});
check(
	"完整 URL 以 gateway 开头",
	fullUrl.startsWith("http://localhost:8080/"),
	`实际：${fullUrl}`,
);
check(
	"完整 URL 包含 /search/list",
	fullUrl.includes("/search/list"),
	`实际：${fullUrl}`,
);
check(
	"完整 URL 包含 key 参数",
	fullUrl.includes("key=test"),
	`实际：${fullUrl}`,
);

// 自定义 gateway URL
const customUrl = buildSearchUrl("http://192.168.1.100:9090", { pageNo: 2 });
check(
	"自定义 gateway URL 正确",
	customUrl.startsWith("http://192.168.1.100:9090/"),
	`实际：${customUrl}`,
);

// ===== 测试 7：buildItemDetailPath 商品详情路径 =====
section("测试 7：buildItemDetailPath 商品详情路径");

check(
	"buildItemDetailPath(1) === /items/1",
	buildItemDetailPath(1) === "/items/1",
);
check(
	"buildItemDetailPath(12345) === /items/12345",
	buildItemDetailPath(12345) === "/items/12345",
);
check(
	"buildItemDetailPath(999) === /items/999",
	buildItemDetailPath(999) === "/items/999",
);

// ===== 测试 8：getCredentialsFilePath 凭证文件路径 =====
section("测试 8：getCredentialsFilePath 凭证文件路径");

const credPath = getCredentialsFilePath();
const expectedDir = path.join(os.homedir(), ".mall-agent");
const expectedFile = path.join(expectedDir, "credentials.json");

check(
	"凭证路径以 home 目录开头",
	credPath.startsWith(os.homedir()),
	`实际：${credPath}`,
);
check(
	"凭证路径包含 .mall-agent 目录",
	credPath.includes(".mall-agent"),
	`实际：${credPath}`,
);
check(
	"凭证路径包含 credentials.json 文件名",
	credPath.endsWith("credentials.json"),
	`实际：${credPath}`,
);
check(
	"凭证路径与预期一致",
	credPath === expectedFile,
	`实际：${credPath}，预期：${expectedFile}`,
);

// ===== 测试 9：getGatewayUrl 网关 URL =====
section("测试 9：getGatewayUrl 网关 URL");

// 保存原始值
const originalEnv = process.env.ZMALL_GATEWAY_URL;

// 未设置环境变量时使用默认值
delete process.env.ZMALL_GATEWAY_URL;
check(
	"未设置环境变量时默认为 http://localhost:8080",
	getGatewayUrl() === "http://localhost:8080",
	`实际：${getGatewayUrl()}`,
);

// 设置自定义环境变量
process.env.ZMALL_GATEWAY_URL = "http://192.168.1.100:9090";
check(
	"自定义 ZMALL_GATEWAY_URL 正确读取",
	getGatewayUrl() === "http://192.168.1.100:9090",
	`实际：${getGatewayUrl()}`,
);

// 恢复原始值
if (originalEnv !== undefined) {
	process.env.ZMALL_GATEWAY_URL = originalEnv;
} else {
	delete process.env.ZMALL_GATEWAY_URL;
}

// ===== 测试 10：工具注册（mock pi 对象）=====
section("测试 10：工具注册（mock pi 对象）");

registerZmallClientSkill(mockPi as ExtensionAPI);

check(
	"注册了 3 个工具",
	registeredTools.size === 3,
	`实际数量：${registeredTools.size}`,
);
check(
	'zmall_login 工具已注册',
	registeredTools.has("zmall_login"),
);
check(
	'query_items 工具已注册',
	registeredTools.has("query_items"),
);
check(
	'query_item_detail 工具已注册',
	registeredTools.has("query_item_detail"),
);

// ===== 测试 11：zmall_login 工具结构 =====
section("测试 11：zmall_login 工具结构");

const loginTool = registeredTools.get("zmall_login");
check(
	"zmall_login 工具存在",
	loginTool !== undefined,
);
check(
	'zmall_login label === "ZMall Login"',
	loginTool?.label === "ZMall Login",
	`实际：${loginTool?.label}`,
);
check(
	"zmall_login description 非空",
	typeof loginTool?.description === "string" && loginTool.description.length > 0,
);
check(
	"zmall_login promptSnippet 非空",
	typeof loginTool?.promptSnippet === "string" && loginTool.promptSnippet.length > 0,
);

const loginParams = loginTool?.parameters as { properties?: Record<string, unknown> };
check(
	"zmall_login 参数包含 username",
	loginParams?.properties?.username !== undefined,
);
check(
	"zmall_login 参数包含 password",
	loginParams?.properties?.password !== undefined,
);

// ===== 测试 12：query_items 工具结构 =====
section("测试 12：query_items 工具结构");

const queryItemsTool = registeredTools.get("query_items");
check(
	"query_items 工具存在",
	queryItemsTool !== undefined,
);
check(
	'query_items label === "Query Items"',
	queryItemsTool?.label === "Query Items",
	`实际：${queryItemsTool?.label}`,
);
check(
	"query_items description 非空",
	typeof queryItemsTool?.description === "string" && queryItemsTool.description.length > 0,
);
check(
	"query_items promptSnippet 非空",
	typeof queryItemsTool?.promptSnippet === "string" && queryItemsTool.promptSnippet.length > 0,
);

const queryParams = queryItemsTool?.parameters as { properties?: Record<string, unknown> };
check(
	"query_items 参数包含 pageNo",
	queryParams?.properties?.pageNo !== undefined,
);
check(
	"query_items 参数包含 pageSize",
	queryParams?.properties?.pageSize !== undefined,
);
check(
	"query_items 参数包含 keyword",
	queryParams?.properties?.keyword !== undefined,
);
check(
	"query_items 参数包含 category",
	queryParams?.properties?.category !== undefined,
);
check(
	"query_items 参数包含 minPrice",
	queryParams?.properties?.minPrice !== undefined,
);
check(
	"query_items 参数包含 maxPrice",
	queryParams?.properties?.maxPrice !== undefined,
);

// ===== 测试 13：query_item_detail 工具结构 =====
section("测试 13：query_item_detail 工具结构");

const detailTool = registeredTools.get("query_item_detail");
check(
	"query_item_detail 工具存在",
	detailTool !== undefined,
);
check(
	'query_item_detail label === "Query Item Detail"',
	detailTool?.label === "Query Item Detail",
	`实际：${detailTool?.label}`,
);
check(
	"query_item_detail description 非空",
	typeof detailTool?.description === "string" && detailTool.description.length > 0,
);
check(
	"query_item_detail promptSnippet 非空",
	typeof detailTool?.promptSnippet === "string" && detailTool.promptSnippet.length > 0,
);

const detailParams = detailTool?.parameters as { properties?: Record<string, unknown> };
check(
	"query_item_detail 参数包含 itemId",
	detailParams?.properties?.itemId !== undefined,
);

// ===== 测试 14：zmall-client 已加入角色权限映射（通过 index 导出）=====
section("测试 14：zmall-client 已加入角色权限映射");

const permissionMap = buildToolPermissionMap();

check(
	"权限映射包含 zmall_login",
	permissionMap.has("zmall_login"),
);
check(
	"权限映射包含 query_items",
	permissionMap.has("query_items"),
);
check(
	"权限映射包含 query_item_detail",
	permissionMap.has("query_item_detail"),
);

// 所有角色都应允许使用 zmall-client 工具
for (const role of ["customer", "merchant", "admin"] as const) {
	check(
		`${role} 允许使用 zmall_login`,
		isToolAllowed("zmall_login", role, permissionMap) === true,
	);
	check(
		`${role} 允许使用 query_items`,
		isToolAllowed("query_items", role, permissionMap) === true,
	);
	check(
		`${role} 允许使用 query_item_detail`,
		isToolAllowed("query_item_detail", role, permissionMap) === true,
	);
}

// ===== 总结 =====
console.log("\n========================================");
console.log(`通过：${passCount}  失败：${failCount}`);
console.log("========================================");
if (failCount > 0) {
	console.error("\n❌ ZMall client skill 验证失败，请检查上方失败项。");
	process.exit(1);
} else {
	console.log("\n✅ 所有测试通过！Task 6 ZMall API Client Skill 验证成功。");
	console.log(`\n已注册工具：${[...registeredTools.keys()].join(", ")}`);
	console.log(`\n下一步：启动 ZMall 后端后，用以下命令端到端验证：`);
	console.log(`  D:\\nvm\\v22.19.0\\node.exe node_modules\\tsx\\dist\\cli.mjs \\`);
	console.log(`    --tsconfig tsconfig.json \\`);
	console.log(`    packages\\coding-agent\\src\\cli.ts \\`);
	console.log(`    --provider <provider> --model <model> \\`);
	console.log(`    -p "Use zmall_login to login with username testuser and password testpass"`);
}
