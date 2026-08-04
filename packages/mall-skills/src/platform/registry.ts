import type { EcommercePlatform } from "./types.ts";

const platforms = new Map<string, EcommercePlatform>();

export function registerPlatform(adapter: EcommercePlatform): void {
	const id = adapter.platformId;
	if (platforms.has(id)) {
		throw new Error(`Platform "${id}" is already registered.`);
	}
	platforms.set(id, adapter);
}

export function getPlatform(platformId: string): EcommercePlatform {
	const adapter = platforms.get(platformId);
	if (!adapter) {
		const available = listPlatformIds().join(", ");
		throw new Error(`Unknown platform: ${platformId}. Available: ${available}`);
	}
	return adapter;
}

export function listPlatformIds(): string[] {
	return [...platforms.keys()];
}

export function clearPlatforms(): void {
	platforms.clear();
}
