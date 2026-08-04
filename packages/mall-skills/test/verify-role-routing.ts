/**
 * Task 5 角色路由 & skill 白名单 验证脚本
 *
 * 不依赖 LLM，直接验证三个内部函数：
 *   1. resolveRole            —— 解析 --role flag，非法值回退默认
 *   2. buildToolPermissionMap —— 构建 toolName → allowedRoles 映射
 *   3. isToolAllowed          —— 按角色判断工具是否放行（非 mall-skills 工具默认放行）
 *
 * 运行方式（从 monorepo 根目录）：
 *   node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json \
 *     packages/mall-skills/test/verify-role-routing.ts
 */

import {
	resolveRole,
	buildToolPermissionMap,
	isToolAllowed,
} from "../src/index.ts";
import { DEFAULT_ROLE, ALL_ROLES, type Role } from "../src/types.ts";
import {
	echoSkillConfig,
} from "../src/skills/echo.ts";
import {
	testCustomerOnlyConfig,
} from "../src/skills/test-customer-only.ts";
import {
	testMerchantOnlyConfig,
} from "../src/skills/test-merchant-only.ts";
import {
	zmallSkillConfig,
} from "../src/skills/zmall-client.ts";

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

// ===== 测试 1：resolveRole 正确解析合法角色 =====
section("测试 1：resolveRole 解析合法角色");

check(
	'resolveRole("customer") === "customer"',
	resolveRole("customer") === "customer",
);
check(
	'resolveRole("merchant") === "merchant"',
	resolveRole("merchant") === "merchant",
);
check(
	'resolveRole("admin") === "admin"',
	resolveRole("admin") === "admin",
);

// 每个合法角色都应原样返回
for (const r of ALL_ROLES) {
	check(
		`resolveRole(${JSON.stringify(r)}) 原样返回`,
		resolveRole(r) === r,
	);
}

// ===== 测试 2：resolveRole 对非法值回退默认 =====
section("测试 2：resolveRole 非法值回退默认 (customer)");

check(
	'resolveRole("superuser") === DEFAULT_ROLE',
	resolveRole("superuser") === DEFAULT_ROLE,
);
check(
	'resolveRole("") === DEFAULT_ROLE',
	resolveRole("") === DEFAULT_ROLE,
);
check(
	"resolveRole(undefined) === DEFAULT_ROLE",
	resolveRole(undefined) === DEFAULT_ROLE,
);
check(
	"resolveRole(true) === DEFAULT_ROLE (非字符串)",
	resolveRole(true) === DEFAULT_ROLE,
);
check(
	"resolveRole(false) === DEFAULT_ROLE (非字符串)",
	resolveRole(false) === DEFAULT_ROLE,
);
check(
	'resolveRole("Customer") === DEFAULT_ROLE (大小写敏感)',
	resolveRole("Customer") === DEFAULT_ROLE,
);
check(
	'resolveRole("guest") === DEFAULT_ROLE',
	resolveRole("guest") === DEFAULT_ROLE,
);

// ===== 测试 3：buildToolPermissionMap 正确构建映射 =====
section("测试 3：buildToolPermissionMap 映射结构");

const permissionMap = buildToolPermissionMap();

check(
	"映射包含 12 个工具（3 原始 + 3 zmall-client + 4 product-research + 2 ai-outfit）",
	permissionMap.size === 12,
	`实际 size=${permissionMap.size}`,
);
check(
	'映射包含 "echo"',
	permissionMap.has("echo"),
);
check(
	'映射包含 "test_customer_only"',
	permissionMap.has("test_customer_only"),
);
check(
	'映射包含 "test_merchant_only"',
	permissionMap.has("test_merchant_only"),
);
check(
	'映射包含 "zmall_login"',
	permissionMap.has("zmall_login"),
);
check(
	'映射包含 "query_items"',
	permissionMap.has("query_items"),
);
check(
	'映射包含 "query_item_detail"',
	permissionMap.has("query_item_detail"),
);

// 验证每个工具的 allowedRoles 与对应 skill 配置一致
check(
	'echo.allowedRoles = ["customer","merchant","admin"]',
	JSON.stringify(permissionMap.get("echo")) ===
		JSON.stringify([...echoSkillConfig.allowedRoles]),
);
check(
	'test_customer_only.allowedRoles = ["customer"]',
	JSON.stringify(permissionMap.get("test_customer_only")) ===
		JSON.stringify([...testCustomerOnlyConfig.allowedRoles]),
);
check(
	'test_merchant_only.allowedRoles = ["merchant"]',
	JSON.stringify(permissionMap.get("test_merchant_only")) ===
		JSON.stringify([...testMerchantOnlyConfig.allowedRoles]),
);
check(
	'zmall_login.allowedRoles = ["customer","merchant","admin"]',
	JSON.stringify(permissionMap.get("zmall_login")) ===
		JSON.stringify([...zmallSkillConfig.allowedRoles]),
);
check(
	'query_items.allowedRoles = ["customer","merchant","admin"]',
	JSON.stringify(permissionMap.get("query_items")) ===
		JSON.stringify([...zmallSkillConfig.allowedRoles]),
);
check(
	'query_item_detail.allowedRoles = ["customer","merchant","admin"]',
	JSON.stringify(permissionMap.get("query_item_detail")) ===
		JSON.stringify([...zmallSkillConfig.allowedRoles]),
);

// 映射是同一引用（确保 skillRegistry 共享 allowedRoles）
check(
	"echo allowedRoles 引用与 echoSkillConfig 一致",
	permissionMap.get("echo") === echoSkillConfig.allowedRoles,
);

// ===== 测试 4：customer 角色权限 =====
section("测试 4：customer 角色工具权限");

const customer: Role = "customer";
check(
	"customer: echo = allowed",
	isToolAllowed("echo", customer, permissionMap) === true,
);
check(
	"customer: test_customer_only = allowed",
	isToolAllowed("test_customer_only", customer, permissionMap) === true,
);
check(
	"customer: test_merchant_only = blocked",
	isToolAllowed("test_merchant_only", customer, permissionMap) === false,
);

// ===== 测试 5：merchant 角色权限 =====
section("测试 5：merchant 角色工具权限");

const merchant: Role = "merchant";
check(
	"merchant: echo = allowed",
	isToolAllowed("echo", merchant, permissionMap) === true,
);
check(
	"merchant: test_customer_only = blocked",
	isToolAllowed("test_customer_only", merchant, permissionMap) === false,
);
check(
	"merchant: test_merchant_only = allowed",
	isToolAllowed("test_merchant_only", merchant, permissionMap) === true,
);

// ===== 测试 6：admin 角色权限 =====
section("测试 6：admin 角色工具权限");

const admin: Role = "admin";
check(
	"admin: echo = allowed",
	isToolAllowed("echo", admin, permissionMap) === true,
);
check(
	"admin: test_customer_only = blocked (admin 不在 allowedRoles)",
	isToolAllowed("test_customer_only", admin, permissionMap) === false,
);
check(
	"admin: test_merchant_only = blocked (admin 不在 allowedRoles)",
	isToolAllowed("test_merchant_only", admin, permissionMap) === false,
);

// ===== 测试 7：未知工具默认放行（default open） =====
section("测试 7：未知工具默认放行（default open）");

for (const r of ALL_ROLES) {
	check(
		`未知工具 "unknown_tool" 对 ${r} 放行`,
		isToolAllowed("unknown_tool", r, permissionMap) === true,
	);
	check(
		`非 mall-skills 工具 "read" 对 ${r} 放行`,
		isToolAllowed("read", r, permissionMap) === true,
	);
	check(
		`非 mall-skills 工具 "bash" 对 ${r} 放行`,
		isToolAllowed("bash", r, permissionMap) === true,
	);
}

// ===== 测试 8：端到端 resolveRole + isToolAllowed 组合 =====
section("测试 8：resolveRole + isToolAllowed 组合（模拟 session_start）");

// 模拟 --role customer
let role = resolveRole("customer");
check(
	'--role customer → echo 可用',
	isToolAllowed("echo", role, permissionMap) === true,
);
check(
	'--role customer → test_merchant_only 被禁',
	isToolAllowed("test_merchant_only", role, permissionMap) === false,
);

// 模拟 --role merchant
role = resolveRole("merchant");
check(
	'--role merchant → test_merchant_only 可用',
	isToolAllowed("test_merchant_only", role, permissionMap) === true,
);
check(
	'--role merchant → test_customer_only 被禁',
	isToolAllowed("test_customer_only", role, permissionMap) === false,
);

// 模拟 --role admin
role = resolveRole("admin");
check(
	'--role admin → echo 可用',
	isToolAllowed("echo", role, permissionMap) === true,
);
check(
	'--role admin → test_customer_only 被禁',
	isToolAllowed("test_customer_only", role, permissionMap) === false,
);

// 模拟非法 --role（应回退 customer）
role = resolveRole("superuser");
check(
	'--role superuser (非法) → 回退 customer → test_customer_only 可用',
	isToolAllowed("test_customer_only", role, permissionMap) === true,
);
check(
	'--role superuser (非法) → 回退 customer → test_merchant_only 被禁',
	isToolAllowed("test_merchant_only", role, permissionMap) === false,
);

// 模拟未指定 --role（undefined）
role = resolveRole(undefined);
check(
	'未指定 --role → 回退 customer → test_customer_only 可用',
	isToolAllowed("test_customer_only", role, permissionMap) === true,
);

// ===== 总结 =====
console.log("\n========================================");
console.log(`通过：${passCount}  失败：${failCount}`);
console.log("========================================");
if (failCount > 0) {
	console.error("\n❌ 角色路由验证失败，请检查上方失败项。");
	process.exit(1);
} else {
	console.log("\n✅ 所有测试通过！Task 5 角色路由 & skill 白名单逻辑正确。");
}
