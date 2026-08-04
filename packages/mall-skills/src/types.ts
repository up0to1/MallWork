/**
 * Mall Skills 共享类型定义
 *
 * 为 Task 5 的角色权限系统预留。当前 Task 4 仅定义类型，不实现过滤逻辑。
 */

/** Agent 角色：customer=前台用户，merchant=后台商家，admin=平台管理员 */
export type Role = "customer" | "merchant" | "admin";

/** 默认角色（未指定 --role 时使用） */
export const DEFAULT_ROLE: Role = "customer";

/** 所有角色列表，用于校验 */
export const ALL_ROLES: readonly Role[] = ["customer", "merchant", "admin"] as const;

/**
 * Mall Skill 配置。
 * 每个 skill 模块导出一个 MallSkillConfig，声明自己允许的角色和注册的工具名。
 * Task 5 的角色过滤逻辑将读取此配置，按角色启用/禁用对应工具。
 */
export interface MallSkillConfig {
	/** skill 名称 */
	name: string;
	/** 允许使用此 skill 的角色列表 */
	allowedRoles: readonly Role[];
	/** 此 skill 注册的工具名列表（用于角色过滤时按工具名禁用） */
	toolNames: readonly string[];
}
