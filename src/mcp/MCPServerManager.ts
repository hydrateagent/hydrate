import { EventEmitter } from "events";
import { MCPServer, MCPServerEvents } from "./MCPServer";
import {
	MCPServerConfig,
	MCPServerStatus,
	MCPServerHealth,
	MCPServerStats,
	MCPServerConfigValidator,
} from "./MCPServerConfig";
// MCPToolDiscovery types - inline definitions
export interface MCPToolSchemaWithMetadata {
	name: string;
	description: string;
	inputSchema: any;
	serverId: string;
	serverName: string;
	discoveredAt: Date;
	lastUpdated: Date;
	schemaHash: string;
	available: boolean;
	category?: string;
	tags?: string[];
	stats?: {
		callCount: number;
		successRate: number;
	};
}

/**
 * Events emitted by MCPServerManager
 */
export interface MCPServerManagerEvents {
	"server-added": (serverId: string, config: MCPServerConfig) => void;
	"server-removed": (serverId: string) => void;
	"server-status-changed": (
		serverId: string,
		status: MCPServerStatus,
		previousStatus: MCPServerStatus
	) => void;
	"server-health-changed": (
		serverId: string,
		health: MCPServerHealth,
		previousHealth: MCPServerHealth
	) => void;
	"server-error": (serverId: string, error: Error) => void;
	"tools-discovered": (serverId: string, toolCount: number) => void;
	"configuration-saved": () => void;
	"configuration-loaded": (serverCount: number) => void;
	error: (error: Error) => void;
}

/**
 * Server registry entry
 */
interface ServerEntry {
	server: MCPServer;
	config: MCPServerConfig;
	lastSeen: Date;
}

/**
 * Manager statistics
 */
export interface MCPManagerStats {
	totalServers: number;
	runningServers: number;
	healthyServers: number;
	totalTools: number;
	uptime: number;
	lastConfigSave: Date | null;
}

/**
 * Configuration persistence interface
 */
export interface MCPConfigStorage {
	saveConfig(config: any): Promise<void>;
	loadConfig(): Promise<any>;
}

/**
 * MCP Server Manager - Orchestrates multiple MCP servers
 */
export class MCPServerManager extends EventEmitter {
	private servers = new Map<string, ServerEntry>();
	private discoveredTools = new Map<string, MCPToolSchemaWithMetadata[]>();
	private storage: MCPConfigStorage | null = null;
	private startTime = new Date();
	private autoSaveEnabled = true;
	private autoSaveDelay = 1000; // 1 second debounce
	private autoSaveTimeout: NodeJS.Timeout | null = null;
	private customPaths: string[] = [];

	constructor() {
		super();
		this.setupServerEventHandlers =
			this.setupServerEventHandlers.bind(this);
	}

	/**
	 * Set configuration storage backend
	 */
	setStorage(storage: MCPConfigStorage): void {
		this.storage = storage;
	}

	/**
	 * Set custom PATH directories for MCP servers
	 */
	setCustomPaths(paths: string[]): void {
		this.customPaths = paths;
	}

	/**
	 * Add a new MCP server
	 */
	async addServer(
		serverId: string,
		config: Partial<MCPServerConfig>
	): Promise<void> {
		if (this.servers.has(serverId)) {
			throw new Error(`Server with ID '${serverId}' already exists`);
		}

		// Add server ID to configuration
		const configWithId = { ...config, id: serverId };

		// Validate configuration
		const errors = MCPServerConfigValidator.validate(configWithId);
		if (errors.length > 0) {
			throw new Error(
				`Invalid server configuration: ${errors.join(", ")}`
			);
		}

		const fullConfig = MCPServerConfigValidator.withDefaults(configWithId);
		const server = new MCPServer(fullConfig, this.customPaths);

		// Set up event forwarding
		this.setupServerEventHandlers(serverId, server);

		// Add to registry
		this.servers.set(serverId, {
			server,
			config: fullConfig,
			lastSeen: new Date(),
		});

		// Auto-start if enabled
		if (fullConfig.enabled && fullConfig.autoRestart) {
			try {
				await server.start();
			} catch (error) {
				console.warn(
					`Failed to auto-start server '${serverId}':`,
					error
				);
			}
		}

		this.emit("server-added", serverId, fullConfig);
		this.scheduleAutoSave();
	}

	/**
	 * Remove an MCP server
	 */
	async removeServer(serverId: string): Promise<void> {
		const entry = this.servers.get(serverId);
		if (!entry) {
			throw new Error(`Server with ID '${serverId}' not found`);
		}

		// Stop the server if running
		try {
			await entry.server.stop();
		} catch (error) {
			console.warn(`Error stopping server '${serverId}':`, error);
		}

		// Clear server cache from tool discovery
		this.discoveredTools.delete(serverId);

		// Clean up event listeners
		entry.server.removeAllListeners();
		entry.server.dispose();

		// Remove from registry
		this.servers.delete(serverId);

		this.emit("server-removed", serverId);
		this.scheduleAutoSave();
	}

	/**
	 * Update server configuration
	 */
	async updateServerConfig(
		serverId: string,
		config: Partial<MCPServerConfig>
	): Promise<void> {
		const entry = this.servers.get(serverId);
		if (!entry) {
			throw new Error(`Server with ID '${serverId}' not found`);
		}

		await entry.server.updateConfig(config);
		entry.config = entry.server.getConfig();
		entry.lastSeen = new Date();

		this.scheduleAutoSave();
	}

	/**
	 * Start a server
	 */
	async startServer(serverId: string): Promise<void>;
	async startServer(config: MCPServerConfig): Promise<void>;
	async startServer(
		serverIdOrConfig: string | MCPServerConfig
	): Promise<void> {
		if (typeof serverIdOrConfig === "string") {
			const entry = this.servers.get(serverIdOrConfig);
			if (!entry) {
				throw new Error(
					`Server with ID '${serverIdOrConfig}' not found`
				);
			}

			await entry.server.start();
			entry.lastSeen = new Date();
		} else {
			// Starting a server by config - add it first if it doesn't exist
			const config = serverIdOrConfig;
			if (!this.servers.has(config.id)) {
				await this.addServer(config.id, config);
			}
			await this.startServer(config.id);
		}
	}

	/**
	 * Stop a server
	 */
	async stopServer(serverId: string): Promise<void> {
		const entry = this.servers.get(serverId);
		if (!entry) {
			throw new Error(`Server with ID '${serverId}' not found`);
		}

		await entry.server.stop();
		entry.lastSeen = new Date();
	}

	/**
	 * Restart a server
	 */
	async restartServer(serverId: string): Promise<void> {
		const entry = this.servers.get(serverId);
		if (!entry) {
			throw new Error(`Server with ID '${serverId}' not found`);
		}

		await entry.server.restart();
		entry.lastSeen = new Date();
	}

	/**
	 * Start all enabled servers
	 */
	async startAllServers(): Promise<void> {
		const startPromises: Promise<void>[] = [];

		for (const [serverId, entry] of this.servers) {
			if (entry.config.enabled) {
				startPromises.push(
					this.startServer(serverId).catch((error) => {
						console.warn(
							`Failed to start server '${serverId}':`,
							error
						);
						this.emit("server-error", serverId, error);
					})
				);
			}
		}

		await Promise.allSettled(startPromises);
	}

	/**
	 * Stop all servers
	 */
	async stopAllServers(): Promise<void> {
		const stopPromises: Promise<void>[] = [];

		for (const [serverId] of this.servers) {
			stopPromises.push(
				this.stopServer(serverId).catch((error) => {
					console.warn(`Failed to stop server '${serverId}':`, error);
				})
			);
		}

		await Promise.allSettled(stopPromises);
	}

	/**
	 * Get server configuration
	 */
	getServerConfig(serverId: string): MCPServerConfig | null {
		const entry = this.servers.get(serverId);
		return entry ? { ...entry.config } : null;
	}

	/**
	 * Get server status
	 */
	getServerStatus(serverId: string): MCPServerStatus | null {
		const entry = this.servers.get(serverId);
		return entry ? entry.server.getStatus() : null;
	}

	/**
	 * Get server health
	 */
	getServerHealth(serverId: string): MCPServerHealth | null {
		const entry = this.servers.get(serverId);
		return entry ? entry.server.getHealth() : null;
	}

	/**
	 * Get server statistics
	 */
	getServerStats(serverId: string): MCPServerStats | null {
		const entry = this.servers.get(serverId);
		return entry ? entry.server.getStats() : null;
	}

	/**
	 * Get all server IDs
	 */
	getServerIds(): string[] {
		return Array.from(this.servers.keys());
	}

	/**
	 * Get all server configurations
	 */
	getAllServerConfigs(): Record<string, MCPServerConfig> {
		const configs: Record<string, MCPServerConfig> = {};
		for (const [serverId, entry] of this.servers) {
			configs[serverId] = { ...entry.config };
		}
		return configs;
	}

	/**
	 * Get manager statistics
	 */
	getManagerStats(): MCPManagerStats {
		let runningServers = 0;
		let healthyServers = 0;

		for (const entry of this.servers.values()) {
			if (entry.server.getStatus() === MCPServerStatus.RUNNING) {
				runningServers++;
			}
			if (entry.server.isHealthy()) {
				healthyServers++;
			}
		}

		return {
			totalServers: this.servers.size,
			runningServers,
			healthyServers,
			totalTools: Array.from(this.discoveredTools.values()).reduce(
				(total, tools) => total + tools.length,
				0
			),
			uptime: Date.now() - this.startTime.getTime(),
			lastConfigSave: this.storage ? new Date() : null,
		};
	}

	/**
	 * Get all discovered tools
	 */
	getAllTools(): MCPToolSchemaWithMetadata[] {
		const allTools: MCPToolSchemaWithMetadata[] = [];
		for (const tools of this.discoveredTools.values()) {
			allTools.push(...tools);
		}
		return allTools;
	}

	/**
	 * Get tools from a specific server
	 */
	getToolsFromServer(serverId: string): MCPToolSchemaWithMetadata[] {
		console.log(
			`MCPServerManager: getToolsFromServer called for ${serverId}`
		);
		const tools = this.discoveredTools.get(serverId) || [];
		console.log(
			`MCPServerManager: getToolsFromServer(${serverId}) returned:`,
			tools
		);
		return tools;
	}

	/**
	 * Refresh tool discovery for all servers
	 */
	async refreshAllTools(): Promise<void> {
		const refreshPromises: Promise<void>[] = [];

		for (const [serverId, entry] of this.servers) {
			if (entry.server.getStatus() === MCPServerStatus.RUNNING) {
				refreshPromises.push(
					this.refreshServerTools(serverId).catch((error) => {
						console.warn(
							`Failed to refresh tools for server '${serverId}':`,
							error
						);
					})
				);
			}
		}

		await Promise.allSettled(refreshPromises);
	}

	/**
	 * Refresh tool discovery for a specific server
	 */
	async refreshServerTools(serverId: string): Promise<void> {
		const entry = this.servers.get(serverId);
		if (!entry) {
			throw new Error(`Server with ID '${serverId}' not found`);
		}

		if (entry.server.getStatus() === MCPServerStatus.RUNNING) {
			// Simple tool discovery - just get tools from the server
			try {
				const client = entry.server.getClient();
				if (client) {
					const tools = await client.listTools();
					const toolsWithMetadata: MCPToolSchemaWithMetadata[] =
						tools.map((tool) => ({
							name: tool.name,
							description: tool.description || "",
							inputSchema: tool.inputSchema || {},
							serverId: serverId,
							serverName: entry.config.name,
							discoveredAt: new Date(),
							lastUpdated: new Date(),
							schemaHash: JSON.stringify(tool).substring(0, 8),
							available: true,
							category: "general",
							tags: [],
							stats: { callCount: 0, successRate: 1 },
						}));
					this.discoveredTools.set(serverId, toolsWithMetadata);
					this.emit(
						"tools-discovered",
						serverId,
						toolsWithMetadata.length
					);
				}
			} catch (error) {
				console.warn(
					`Failed to discover tools for server '${serverId}':`,
					error
				);
				this.discoveredTools.set(serverId, []);
			}
		} else {
			throw new Error(`Server '${serverId}' is not running`);
		}
	}

	/**
	 * Save configuration to storage
	 */
	async saveConfiguration(): Promise<void> {
		if (!this.storage) {
			throw new Error("No storage backend configured");
		}

		const configs = this.getAllServerConfigs();
		await this.storage.saveConfig({ servers: Object.values(configs) });
		this.emit("configuration-saved");
	}

	/**
	 * Load configuration from storage
	 */
	async loadConfiguration(): Promise<void> {
		if (!this.storage) {
			throw new Error("No storage backend configured");
		}

		try {
			const config = await this.storage.loadConfig();
			const servers = config.servers || [];
			let loadedCount = 0;

			for (const serverConfig of servers) {
				try {
					await this.addServer(serverConfig.id, serverConfig);
					loadedCount++;
				} catch (error) {
					console.warn(
						`Failed to load server '${serverConfig.id}':`,
						error
					);
					this.emit("error", error as Error);
				}
			}

			this.emit("configuration-loaded", loadedCount);
		} catch (error) {
			console.warn("Failed to load configuration:", error);
			this.emit("configuration-loaded", 0);
		}
	}

	/**
	 * Perform health check on all servers
	 */
	async performHealthCheck(): Promise<Record<string, boolean>> {
		const results: Record<string, boolean> = {};

		for (const [serverId, entry] of this.servers) {
			try {
				results[serverId] = await entry.server.performHealthCheck();
			} catch (error) {
				results[serverId] = false;
				this.emit("server-error", serverId, error as Error);
			}
		}

		return results;
	}

	/**
	 * Get server by ID
	 */
	getServer(serverId: string): MCPServer | null {
		const entry = this.servers.get(serverId);
		return entry ? entry.server : null;
	}

	/**
	 * Check if server exists
	 */
	hasServer(serverId: string): boolean {
		return this.servers.has(serverId);
	}

	/**
	 * Execute a tool call on a specific server
	 */
	async executeToolCall(
		serverId: string,
		toolName: string,
		parameters: any
	): Promise<any> {
		const entry = this.servers.get(serverId);
		if (!entry) {
			throw new Error(`Server with ID '${serverId}' not found`);
		}

		if (entry.server.getStatus() !== MCPServerStatus.RUNNING) {
			throw new Error(
				`Server '${serverId}' is not running (status: ${entry.server.getStatus()})`
			);
		}

		const client = entry.server.getClient();
		if (!client) {
			throw new Error(`Server '${serverId}' has no active client`);
		}

		try {
			const result = await client.callTool(toolName, parameters);
			return result;
		} catch (error) {
			throw new Error(
				`Tool execution failed: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
		}
	}

	/**
	 * Test server connection without adding it to the registry
	 */
	async testServerConnection(config: MCPServerConfig): Promise<{
		success: boolean;
		error?: string;
		toolCount?: number;
		latency?: number;
	}> {
		const startTime = Date.now();

		try {
			// Validate configuration first
			const errors = MCPServerConfigValidator.validate(config);
			if (errors.length > 0) {
				return {
					success: false,
					error: `Configuration errors: ${errors.join(", ")}`,
				};
			}

			// Create a temporary server instance
			const testServer = new MCPServer(config, this.customPaths);

			try {
				// Start the server
				await testServer.start();

				// Wait a moment for server to fully initialize
				await new Promise((resolve) => setTimeout(resolve, 1000));

				// Check if server is running
				if (testServer.getStatus() !== MCPServerStatus.RUNNING) {
					return {
						success: false,
						error: "Server failed to start properly",
						latency: Date.now() - startTime,
					};
				}

				// Try to discover tools
				let toolCount = 0;
				try {
					const tools = this.getToolsFromServer(config.id);
					toolCount = tools.length;
				} catch (toolError) {
					console.warn(
						"Tool discovery failed during test:",
						toolError
					);
					// Don't fail the test just because tool discovery failed
				}

				return {
					success: true,
					toolCount,
					latency: Date.now() - startTime,
				};
			} finally {
				// Always clean up the test server
				try {
					await testServer.stop();
					testServer.dispose();
				} catch (cleanupError) {
					console.warn(
						"Error cleaning up test server:",
						cleanupError
					);
				}
			}
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				latency: Date.now() - startTime,
			};
		}
	}

	/**
	 * Dispose of all resources
	 */
	async dispose(): Promise<void> {
		// Clear auto-save timeout
		if (this.autoSaveTimeout) {
			clearTimeout(this.autoSaveTimeout);
			this.autoSaveTimeout = null;
		}

		// Stop all servers
		await this.stopAllServers();

		// Dispose of all servers
		for (const entry of this.servers.values()) {
			entry.server.dispose();
		}

		// Clear registry
		this.servers.clear();

		// Dispose tool discovery
		this.discoveredTools.clear();

		// Remove all listeners
		this.removeAllListeners();
	}

	/**
	 * Set up event handlers for a server
	 */
	private setupServerEventHandlers(
		serverId: string,
		server: MCPServer
	): void {
		server.on("status-changed", async (status, previousStatus) => {
			console.log(
				`MCPServerManager: Server ${serverId} status changed from ${previousStatus} to ${status}`
			);

			// Trigger tool discovery when server becomes running
			if (status === "running" && previousStatus !== "running") {
				console.log(
					`MCPServerManager: Triggering tool discovery for newly running server ${serverId}`
				);
				try {
					await this.refreshServerTools(serverId);
				} catch (error) {
					console.error(
						`MCPServerManager: Tool discovery failed for server ${serverId}:`,
						error
					);
				}
			}

			this.emit(
				"server-status-changed",
				serverId,
				status,
				previousStatus
			);
		});

		server.on("health-changed", (health, previousHealth) => {
			this.emit(
				"server-health-changed",
				serverId,
				health,
				previousHealth
			);
		});

		server.on("error", (error) => {
			this.emit("server-error", serverId, error);
		});

		server.on("tools-discovered", (toolCount) => {
			this.emit("tools-discovered", serverId, toolCount);
		});
	}

	/**
	 * Schedule automatic configuration save
	 */
	private scheduleAutoSave(): void {
		if (!this.autoSaveEnabled || !this.storage) {
			return;
		}

		// Clear existing timeout
		if (this.autoSaveTimeout) {
			clearTimeout(this.autoSaveTimeout);
		}

		// Schedule new save
		this.autoSaveTimeout = setTimeout(async () => {
			try {
				await this.saveConfiguration();
			} catch (error) {
				console.warn("Auto-save failed:", error);
				this.emit("error", error as Error);
			}
		}, this.autoSaveDelay);
	}

	/**
	 * Get all discovered MCP tools from running servers
	 */
	async getAllDiscoveredTools(): Promise<any[]> {
		console.log(
			`MCPServerManager: Starting tool collection from ${this.servers.size} servers`
		);
		console.log(
			`MCPServerManager: Server IDs:`,
			Array.from(this.servers.keys())
		);

		const allTools: any[] = [];
		let serverCount = 0;
		let toolCount = 0;

		for (const [serverId, server] of this.servers) {
			try {
				console.log(
					`MCPServerManager: Getting tools from server ${serverId}...`
				);
				const tools = this.getToolsFromServer(serverId);
				console.log(
					`MCPServerManager: Server ${serverId} provided ${tools.length} tools`
				);
				allTools.push(...tools);
				serverCount++;
				toolCount += tools.length;
			} catch (error) {
				console.error(
					`MCPServerManager: Failed to get tools from server ${serverId}:`,
					error
				);
			}
		}

		console.log(
			`MCPServerManager: Collected ${toolCount} tools from ${serverCount} servers`
		);
		return allTools;
	}

	/**
	 * Enable/disable automatic configuration saving
	 */
	setAutoSave(enabled: boolean, delayMs = 1000): void {
		this.autoSaveEnabled = enabled;
		this.autoSaveDelay = delayMs;
	}

	/**
	 * Get the number of servers managed
	 */
	getServerCount(): number {
		return this.servers.size;
	}

	/**
	 * Get server statuses for debugging
	 */
	getServerStatuses(): Record<string, string> {
		const statuses: Record<string, string> = {};
		for (const [serverId, entry] of this.servers.entries()) {
			statuses[serverId] = entry.server.getStatus();
		}
		return statuses;
	}
}
