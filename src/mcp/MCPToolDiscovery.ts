import { EventEmitter } from "events";
import { MCPClient, MCPToolSchema } from "./MCPClient";
import { MCPServer } from "./MCPServer";

/**
 * Tool schema with additional metadata
 */
export interface MCPToolSchemaWithMetadata extends MCPToolSchema {
	/** Server ID that provides this tool */
	serverId: string;

	/** Server name for display purposes */
	serverName: string;

	/** When this tool was discovered */
	discoveredAt: Date;

	/** Last time schema was updated */
	lastUpdated: Date;

	/** Schema version/hash for change detection */
	schemaHash: string;

	/** Whether this tool is currently available */
	available: boolean;

	/** Tool category/tags from server */
	category?: string;
	tags?: string[];

	/** Usage statistics */
	stats?: {
		callCount: number;
		lastUsed?: Date;
		averageExecutionTime?: number;
		successRate?: number;
	};
}

/**
 * Tool discovery cache entry
 */
interface ToolCacheEntry {
	schema: MCPToolSchemaWithMetadata;
	expires: Date;
	version: number;
}

/**
 * Tool discovery events
 */
export interface MCPToolDiscoveryEvents {
	"tools-discovered": (
		serverId: string,
		tools: MCPToolSchemaWithMetadata[]
	) => void;
	"tool-added": (tool: MCPToolSchemaWithMetadata) => void;
	"tool-updated": (
		tool: MCPToolSchemaWithMetadata,
		previousVersion: MCPToolSchemaWithMetadata
	) => void;
	"tool-removed": (serverId: string, toolName: string) => void;
	"discovery-error": (serverId: string, error: Error) => void;
	"cache-updated": (serverId: string, toolCount: number) => void;
}

/**
 * Tool discovery configuration
 */
export interface MCPToolDiscoveryConfig {
	/** Cache TTL in milliseconds */
	cacheTtl: number;

	/** Auto-discovery interval in milliseconds */
	discoveryInterval: number;

	/** Whether to enable automatic discovery */
	autoDiscovery: boolean;

	/** Maximum number of tools to cache per server */
	maxToolsPerServer: number;

	/** Whether to validate schemas on discovery */
	validateSchemas: boolean;

	/** Timeout for discovery operations */
	discoveryTimeout: number;
}

/**
 * Default discovery configuration
 */
export const DEFAULT_DISCOVERY_CONFIG: MCPToolDiscoveryConfig = {
	cacheTtl: 300000, // 5 minutes
	discoveryInterval: 60000, // 1 minute
	autoDiscovery: true,
	maxToolsPerServer: 100,
	validateSchemas: true,
	discoveryTimeout: 10000, // 10 seconds
};

/**
 * Tool schema discovery and management system
 */
export class MCPToolDiscovery extends EventEmitter {
	private config: MCPToolDiscoveryConfig;
	private toolCache = new Map<string, Map<string, ToolCacheEntry>>();
	private discoveryIntervals = new Map<string, NodeJS.Timeout>();
	private discoveryPromises = new Map<
		string,
		Promise<MCPToolSchemaWithMetadata[]>
	>();

	constructor(config: Partial<MCPToolDiscoveryConfig> = {}) {
		super();
		this.config = { ...DEFAULT_DISCOVERY_CONFIG, ...config };
	}

	/**
	 * Discover tools from a single MCP server
	 */
	async discoverTools(
		server: MCPServer
	): Promise<MCPToolSchemaWithMetadata[]> {
		const serverId = server.getConfig().id;

		// Check if discovery is already in progress
		if (this.discoveryPromises.has(serverId)) {
			return this.discoveryPromises.get(serverId)!;
		}

		// Check cache first
		const cachedTools = this.getCachedTools(serverId);
		if (cachedTools.length > 0 && !this.isCacheExpired(serverId)) {
			return cachedTools;
		}

		// Start discovery
		const discoveryPromise = this.performDiscovery(server);
		this.discoveryPromises.set(serverId, discoveryPromise);

		try {
			const tools = await discoveryPromise;
			this.updateCache(serverId, tools);
			this.emit("tools-discovered", serverId, tools);
			this.emit("cache-updated", serverId, tools.length);
			return tools;
		} catch (error) {
			this.emit("discovery-error", serverId, error as Error);
			throw error;
		} finally {
			this.discoveryPromises.delete(serverId);
		}
	}

	/**
	 * Discover tools from multiple servers
	 */
	async discoverToolsFromServers(
		servers: MCPServer[]
	): Promise<Map<string, MCPToolSchemaWithMetadata[]>> {
		const results = new Map<string, MCPToolSchemaWithMetadata[]>();

		// Discover from all servers in parallel
		const discoveries = servers.map(async (server) => {
			const serverId = server.getConfig().id;
			try {
				const tools = await this.discoverTools(server);
				results.set(serverId, tools);
			} catch (error) {
				console.warn(
					`Failed to discover tools from server ${serverId}:`,
					error
				);
				results.set(serverId, []);
			}
		});

		await Promise.allSettled(discoveries);
		return results;
	}

	/**
	 * Get all cached tools across all servers
	 */
	getAllTools(): MCPToolSchemaWithMetadata[] {
		const allTools: MCPToolSchemaWithMetadata[] = [];

		for (const [serverId, serverCache] of this.toolCache) {
			for (const [toolName, cacheEntry] of serverCache) {
				if (!this.isCacheEntryExpired(cacheEntry)) {
					allTools.push(cacheEntry.schema);
				}
			}
		}

		return allTools;
	}

	/**
	 * Get tools from a specific server
	 */
	getToolsFromServer(serverId: string): MCPToolSchemaWithMetadata[] {
		return this.getCachedTools(serverId);
	}

	/**
	 * Get a specific tool by server and name
	 */
	getTool(
		serverId: string,
		toolName: string
	): MCPToolSchemaWithMetadata | null {
		const serverCache = this.toolCache.get(serverId);
		if (!serverCache) {
			return null;
		}

		const cacheEntry = serverCache.get(toolName);
		if (!cacheEntry || this.isCacheEntryExpired(cacheEntry)) {
			return null;
		}

		return cacheEntry.schema;
	}

	/**
	 * Search tools by name or description
	 */
	searchTools(query: string): MCPToolSchemaWithMetadata[] {
		const queryLower = query.toLowerCase();
		return this.getAllTools().filter(
			(tool) =>
				tool.name.toLowerCase().includes(queryLower) ||
				tool.description.toLowerCase().includes(queryLower) ||
				tool.tags?.some((tag) => tag.toLowerCase().includes(queryLower))
		);
	}

	/**
	 * Get tools by category
	 */
	getToolsByCategory(category: string): MCPToolSchemaWithMetadata[] {
		return this.getAllTools().filter(
			(tool) =>
				tool.category === category || tool.tags?.includes(category)
		);
	}

	/**
	 * Start auto-discovery for a server
	 */
	startAutoDiscovery(server: MCPServer): void {
		if (!this.config.autoDiscovery) {
			return;
		}

		const serverId = server.getConfig().id;

		// Clear existing interval
		this.stopAutoDiscovery(serverId);

		// Start new interval
		const interval = setInterval(async () => {
			try {
				await this.discoverTools(server);
			} catch (error) {
				console.warn(
					`Auto-discovery failed for server ${serverId}:`,
					error
				);
			}
		}, this.config.discoveryInterval);

		this.discoveryIntervals.set(serverId, interval);
	}

	/**
	 * Stop auto-discovery for a server
	 */
	stopAutoDiscovery(serverId: string): void {
		const interval = this.discoveryIntervals.get(serverId);
		if (interval) {
			clearInterval(interval);
			this.discoveryIntervals.delete(serverId);
		}
	}

	/**
	 * Clear cache for a specific server
	 */
	clearServerCache(serverId: string): void {
		this.toolCache.delete(serverId);
		this.emit("cache-updated", serverId, 0);
	}

	/**
	 * Clear all cached tools
	 */
	clearAllCache(): void {
		const serverIds = Array.from(this.toolCache.keys());
		this.toolCache.clear();

		for (const serverId of serverIds) {
			this.emit("cache-updated", serverId, 0);
		}
	}

	/**
	 * Force refresh tools from a server
	 */
	async refreshTools(
		server: MCPServer
	): Promise<MCPToolSchemaWithMetadata[]> {
		const serverId = server.getConfig().id;
		this.clearServerCache(serverId);
		return this.discoverTools(server);
	}

	/**
	 * Get cache statistics
	 */
	getCacheStats(): {
		totalServers: number;
		totalTools: number;
		cacheHitRate: number;
		averageToolsPerServer: number;
	} {
		const totalServers = this.toolCache.size;
		let totalTools = 0;

		for (const serverCache of this.toolCache.values()) {
			totalTools += serverCache.size;
		}

		return {
			totalServers,
			totalTools,
			cacheHitRate: 0, // TODO: Implement hit rate tracking
			averageToolsPerServer:
				totalServers > 0 ? totalTools / totalServers : 0,
		};
	}

	/**
	 * Update tool usage statistics
	 */
	updateToolStats(
		serverId: string,
		toolName: string,
		executionTime: number,
		success: boolean
	): void {
		const tool = this.getTool(serverId, toolName);
		if (!tool || !tool.stats) {
			return;
		}

		tool.stats.callCount++;
		tool.stats.lastUsed = new Date();

		if (tool.stats.averageExecutionTime) {
			tool.stats.averageExecutionTime =
				(tool.stats.averageExecutionTime + executionTime) / 2;
		} else {
			tool.stats.averageExecutionTime = executionTime;
		}

		if (tool.stats.successRate !== undefined) {
			const totalCalls = tool.stats.callCount;
			const successfulCalls =
				Math.round(tool.stats.successRate * (totalCalls - 1)) +
				(success ? 1 : 0);
			tool.stats.successRate = successfulCalls / totalCalls;
		} else {
			tool.stats.successRate = success ? 1 : 0;
		}
	}

	/**
	 * Dispose of the discovery system
	 */
	dispose(): void {
		// Stop all auto-discovery intervals
		for (const serverId of this.discoveryIntervals.keys()) {
			this.stopAutoDiscovery(serverId);
		}

		// Clear all caches
		this.clearAllCache();

		// Remove all listeners
		this.removeAllListeners();
	}

	/**
	 * Perform the actual tool discovery from a server
	 */
	private async performDiscovery(
		server: MCPServer
	): Promise<MCPToolSchemaWithMetadata[]> {
		const client = server.getClient();
		if (!client) {
			throw new Error("Server client not available");
		}

		const config = server.getConfig();
		const serverId = config.id;

		// Set timeout for discovery
		const timeoutPromise = new Promise<never>((_, reject) => {
			setTimeout(
				() => reject(new Error("Discovery timeout")),
				this.config.discoveryTimeout
			);
		});

		try {
			// Race between discovery and timeout
			const rawTools = await Promise.race([
				client.listTools(),
				timeoutPromise,
			]);

			// Convert to tools with metadata
			const tools: MCPToolSchemaWithMetadata[] = [];
			const now = new Date();

			for (const rawTool of rawTools) {
				if (
					this.config.validateSchemas &&
					!this.validateToolSchema(rawTool)
				) {
					console.warn(
						`Invalid tool schema for ${
							(rawTool as any).name || "unknown"
						} from server ${serverId}`
					);
					continue;
				}

				const schemaHash = this.generateSchemaHash(rawTool);
				const existingTool = this.getTool(serverId, rawTool.name);

				const tool: MCPToolSchemaWithMetadata = {
					...rawTool,
					serverId,
					serverName: config.name,
					discoveredAt: existingTool?.discoveredAt || now,
					lastUpdated: now,
					schemaHash,
					available: true,
					category: this.inferCategory(rawTool),
					tags: config.tags || [],
					stats: existingTool?.stats || {
						callCount: 0,
						successRate: 1.0,
					},
				};

				// Check if tool was updated
				if (existingTool && existingTool.schemaHash !== schemaHash) {
					this.emit("tool-updated", tool, existingTool);
				} else if (!existingTool) {
					this.emit("tool-added", tool);
				}

				tools.push(tool);
			}

			// Check for removed tools
			const existingTools = this.getCachedTools(serverId);
			const currentToolNames = new Set(tools.map((t) => t.name));

			for (const existingTool of existingTools) {
				if (!currentToolNames.has(existingTool.name)) {
					this.emit("tool-removed", serverId, existingTool.name);
				}
			}

			return tools;
		} catch (error) {
			if (
				error instanceof Error &&
				error.message === "Discovery timeout"
			) {
				throw new Error(
					`Tool discovery timed out for server ${serverId}`
				);
			}
			throw error;
		}
	}

	/**
	 * Validate a tool schema
	 */
	private validateToolSchema(tool: any): tool is MCPToolSchema {
		return (
			tool &&
			typeof tool.name === "string" &&
			typeof tool.description === "string" &&
			tool.inputSchema &&
			typeof tool.inputSchema === "object" &&
			tool.inputSchema.type === "object"
		);
	}

	/**
	 * Generate a hash for schema change detection
	 */
	private generateSchemaHash(tool: MCPToolSchema): string {
		const schemaString = JSON.stringify({
			name: tool.name,
			description: tool.description,
			inputSchema: tool.inputSchema,
		});

		// Simple hash function (could use crypto for production)
		let hash = 0;
		for (let i = 0; i < schemaString.length; i++) {
			const char = schemaString.charCodeAt(i);
			hash = (hash << 5) - hash + char;
			hash = hash & hash; // Convert to 32-bit integer
		}

		return hash.toString(36);
	}

	/**
	 * Infer tool category from name and description
	 */
	private inferCategory(tool: MCPToolSchema): string {
		const name = tool.name.toLowerCase();
		const description = tool.description.toLowerCase();

		if (
			name.includes("file") ||
			name.includes("read") ||
			name.includes("write")
		) {
			return "filesystem";
		}
		if (
			name.includes("git") ||
			name.includes("commit") ||
			name.includes("branch")
		) {
			return "version-control";
		}
		if (
			name.includes("db") ||
			name.includes("sql") ||
			name.includes("query")
		) {
			return "database";
		}
		if (
			name.includes("http") ||
			name.includes("api") ||
			name.includes("request")
		) {
			return "network";
		}
		if (description.includes("search") || description.includes("find")) {
			return "search";
		}

		return "general";
	}

	/**
	 * Get cached tools for a server
	 */
	private getCachedTools(serverId: string): MCPToolSchemaWithMetadata[] {
		const serverCache = this.toolCache.get(serverId);
		if (!serverCache) {
			return [];
		}

		const tools: MCPToolSchemaWithMetadata[] = [];
		for (const cacheEntry of serverCache.values()) {
			if (!this.isCacheEntryExpired(cacheEntry)) {
				tools.push(cacheEntry.schema);
			}
		}

		return tools;
	}

	/**
	 * Update cache with discovered tools
	 */
	private updateCache(
		serverId: string,
		tools: MCPToolSchemaWithMetadata[]
	): void {
		if (!this.toolCache.has(serverId)) {
			this.toolCache.set(serverId, new Map());
		}

		const serverCache = this.toolCache.get(serverId)!;
		const now = new Date();
		const expires = new Date(now.getTime() + this.config.cacheTtl);

		// Clear existing cache
		serverCache.clear();

		// Add new tools (limit per server)
		const toolsToCache = tools.slice(0, this.config.maxToolsPerServer);

		for (const tool of toolsToCache) {
			const cacheEntry: ToolCacheEntry = {
				schema: tool,
				expires,
				version: 1,
			};

			serverCache.set(tool.name, cacheEntry);
		}
	}

	/**
	 * Check if cache is expired for a server
	 */
	private isCacheExpired(serverId: string): boolean {
		const serverCache = this.toolCache.get(serverId);
		if (!serverCache || serverCache.size === 0) {
			return true;
		}

		// Check if any tool in cache is expired
		for (const cacheEntry of serverCache.values()) {
			if (!this.isCacheEntryExpired(cacheEntry)) {
				return false; // At least one tool is still valid
			}
		}

		return true; // All tools are expired
	}

	/**
	 * Check if a cache entry is expired
	 */
	private isCacheEntryExpired(entry: ToolCacheEntry): boolean {
		return new Date() > entry.expires;
	}
}
