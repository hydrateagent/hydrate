import { EventEmitter } from "events";
import { MCPClient } from "./MCPClient";
import { StdioTransport, WebSocketTransport } from "./MCPTransport";
import {
	MCPServerConfig,
	MCPServerStatus,
	MCPServerHealth,
	MCPServerStats,
	MCPServerConfigValidator,
} from "./MCPServerConfig";
import { devLog } from "../utils/logger";

/**
 * Events emitted by MCPServer
 */
export interface MCPServerEvents {
	"status-changed": (
		status: MCPServerStatus,
		previousStatus: MCPServerStatus,
	) => void;
	"health-changed": (
		health: MCPServerHealth,
		previousHealth: MCPServerHealth,
	) => void;
	error: (error: Error) => void;
	restart: (attempt: number, maxAttempts: number) => void;
	"tools-discovered": (toolCount: number) => void;
	"stats-updated": (stats: MCPServerStats) => void;
}

/**
 * MCP Server instance that manages a single MCP server process
 */
export class MCPServer extends EventEmitter {
	private config: MCPServerConfig;
	private client: MCPClient | null = null;
	private status: MCPServerStatus = MCPServerStatus.STOPPED;
	private health: MCPServerHealth = MCPServerHealth.UNKNOWN;
	private stats: MCPServerStats;
	private healthCheckInterval: number | null = null;
	private startupTimeout: number | null = null;
	private shutdownTimeout: number | null = null;
	private restartDelay: number | null = null;
	private customPaths: string[] = [];

	constructor(config: Partial<MCPServerConfig>, customPaths?: string[]) {
		super();

		// Validate configuration
		const errors = MCPServerConfigValidator.validate(config);
		if (errors.length > 0) {
			throw new Error(
				`Invalid MCP server configuration: ${errors.join(", ")}`,
			);
		}

		this.config = MCPServerConfigValidator.withDefaults(config);
		this.customPaths = customPaths || [];
		this.stats = this.initializeStats();

		this.setupEventHandlers();
	}

	/**
	 * Get server configuration
	 */
	getConfig(): MCPServerConfig {
		return { ...this.config };
	}

	/**
	 * Update server configuration
	 */
	async updateConfig(newConfig: Partial<MCPServerConfig>): Promise<void> {
		const mergedConfig = { ...this.config, ...newConfig };
		const errors = MCPServerConfigValidator.validate(mergedConfig);

		if (errors.length > 0) {
			throw new Error(
				`Invalid configuration update: ${errors.join(", ")}`,
			);
		}

		const wasRunning = this.status === MCPServerStatus.RUNNING;

		if (wasRunning) {
			await this.stop();
		}

		this.config = MCPServerConfigValidator.withDefaults(mergedConfig);

		if (wasRunning && this.config.enabled) {
			await this.start();
		}
	}

	/**
	 * Start the MCP server
	 */
	async start(): Promise<void> {
		if (!this.config.enabled) {
			throw new Error("Cannot start disabled server");
		}

		if (
			this.status !== MCPServerStatus.STOPPED &&
			this.status !== MCPServerStatus.CRASHED
		) {
			throw new Error(`Cannot start server in ${this.status} state`);
		}

		this.setStatus(MCPServerStatus.STARTING);

		try {
			// Create MCP client with appropriate transport
			if (this.config.transport.type === "sse") {
				if (!this.config.transport.url) {
					throw new Error("URL required for SSE transport");
				}
				const transport = new WebSocketTransport(
					this.config.transport.url,
				);
				this.client = new MCPClient(transport);
			} else {
				const envVars: Record<string, string> = {};

				// Add process environment variables (filter out undefined)
				for (const [key, value] of Object.entries(process.env)) {
					if (value !== undefined) {
						envVars[key] = value;
					}
				}

				// Add custom paths to PATH environment variable
				if (this.customPaths.length > 0) {
					const currentPath = envVars.PATH || process.env.PATH || "";
					const newPaths = this.customPaths.join(":");
					envVars.PATH =
						newPaths + (currentPath ? ":" + currentPath : "");
				}

				// Add config environment variables (these are already strings)
				if (this.config.env) {
					Object.assign(envVars, this.config.env);
				}

				const transport = new StdioTransport(
					this.config.command,
					this.config.args,
					envVars,
				);
				this.client = new MCPClient(transport);
			}

			// Set up client event handlers
			this.setupClientEventHandlers();

			// Set startup timeout
			this.startupTimeout = window.setTimeout(() => {
				this.handleStartupTimeout();
			}, this.config.startupTimeout);

			// Connect to the server
			await this.client.connect();

			// Clear startup timeout
			if (this.startupTimeout) {
				window.clearTimeout(this.startupTimeout);
				this.startupTimeout = null;
			}

			// Update stats
			this.stats.startTime = new Date();
			this.stats.restartCount = 0;
			this.stats.pid = this.getPid();

			// Start health monitoring
			this.startHealthMonitoring();

			// Discover tools
			await this.discoverTools();

			this.setStatus(MCPServerStatus.RUNNING);
			this.setHealth(MCPServerHealth.HEALTHY);
		} catch (error) {
			this.handleStartupError(error as Error);
		}
	}

	/**
	 * Stop the MCP server
	 */
	async stop(): Promise<void> {
		if (this.status === MCPServerStatus.STOPPED) {
			return;
		}

		this.setStatus(MCPServerStatus.STOPPING);

		// Clear all timeouts
		this.clearTimeouts();

		// Stop health monitoring
		this.stopHealthMonitoring();

		if (this.client) {
			try {
				// Set shutdown timeout
				this.shutdownTimeout = window.setTimeout(() => {
					this.handleShutdownTimeout();
				}, this.config.shutdownTimeout);

				await this.client.disconnect();

				if (this.shutdownTimeout) {
					window.clearTimeout(this.shutdownTimeout);
					this.shutdownTimeout = null;
				}
			} catch (error) {
				devLog.warn("Error during client disconnect:", error);
			}

			this.client = null;
		}

		this.setStatus(MCPServerStatus.STOPPED);
		this.setHealth(MCPServerHealth.UNKNOWN);
	}

	/**
	 * Restart the MCP server
	 */
	async restart(): Promise<void> {
		await this.stop();
		await new Promise((resolve) => window.setTimeout(resolve, 1000)); // Brief pause
		await this.start();
	}

	/**
	 * Get current server status
	 */
	getStatus(): MCPServerStatus {
		return this.status;
	}

	/**
	 * Get current health status
	 */
	getHealth(): MCPServerHealth {
		return this.health;
	}

	/**
	 * Get server statistics
	 */
	getStats(): MCPServerStats {
		return {
			...this.stats,
			uptime: this.stats.startTime
				? Date.now() - this.stats.startTime.getTime()
				: undefined,
		};
	}

	/**
	 * Get MCP client for direct communication
	 */
	getClient(): MCPClient | null {
		return this.client;
	}

	/**
	 * Check if server is running and healthy
	 */
	isHealthy(): boolean {
		return (
			this.status === MCPServerStatus.RUNNING &&
			this.health === MCPServerHealth.HEALTHY
		);
	}

	/**
	 * Perform manual health check
	 */
	async performHealthCheck(): Promise<boolean> {
		if (!this.client || this.status !== MCPServerStatus.RUNNING) {
			return false;
		}

		try {
			// Try to list tools as a health check
			await this.client.listTools();
			return true;
		} catch (error) {
			devLog.warn(
				`Health check failed for server ${this.config.id}:`,
				error,
			);
			return false;
		}
	}

	/**
	 * Discover tools from the server
	 */
	async discoverTools(): Promise<void> {
		if (!this.client) {
			throw new Error("Client not available for tool discovery");
		}

		try {
			const tools = await this.client.listTools();
			this.stats.toolCount = tools.length;
			this.stats.lastToolDiscovery = new Date();
			this.emit("tools-discovered", tools.length);
		} catch (error) {
			this.stats.errorCount++;
			this.stats.lastError = new Date();
			throw error;
		}
	}

	private initializeStats(): MCPServerStats {
		return {
			restartCount: 0,
			toolCount: 0,
			toolCallCount: 0,
			errorCount: 0,
		};
	}

	private setupEventHandlers(): void {
		// Handle process cleanup on exit
		process.on("exit", () => {
			this.cleanup();
		});

		process.on("SIGINT", () => {
			this.cleanup();
		});

		process.on("SIGTERM", () => {
			this.cleanup();
		});
	}

	private setupClientEventHandlers(): void {
		if (!this.client) return;

		this.client.on("error", (error: Error) => {
			this.handleClientError(error);
		});

		this.client.on("disconnect", (info: any) => {
			this.handleClientDisconnect(info);
		});

		this.client.on("stderr", (data: string) => {
			devLog.warn(`${this.config.id} Server stderr:`, data.trim());
		});
	}

	private setStatus(newStatus: MCPServerStatus): void {
		const previousStatus = this.status;
		this.status = newStatus;
		this.emit("status-changed", newStatus, previousStatus);
	}

	private setHealth(newHealth: MCPServerHealth): void {
		const previousHealth = this.health;
		this.health = newHealth;
		this.emit("health-changed", newHealth, previousHealth);
	}

	private startHealthMonitoring(): void {
		if (!this.config.healthCheck) return;

		this.healthCheckInterval = window.setInterval(async () => {
			const isHealthy = await this.performHealthCheck();

			if (isHealthy) {
				this.setHealth(MCPServerHealth.HEALTHY);
			} else {
				this.handleHealthCheckFailure();
			}
		}, this.config.healthCheck.interval);
	}

	private stopHealthMonitoring(): void {
		if (this.healthCheckInterval) {
			window.clearInterval(this.healthCheckInterval);
			this.healthCheckInterval = null;
		}
	}

	private handleHealthCheckFailure(): void {
		this.setHealth(MCPServerHealth.UNHEALTHY);

		if (
			this.config.autoRestart &&
			this.stats.restartCount < this.config.maxRestarts
		) {
			this.scheduleRestart();
		}
	}

	private handleClientError(error: Error): void {
		devLog.error(`${this.config.id} Client error:`, error);
		this.stats.errorCount++;
		this.stats.lastError = new Date();
		this.emit("error", error);

		if (this.status === MCPServerStatus.RUNNING) {
			this.setStatus(MCPServerStatus.CRASHED);

			if (
				this.config.autoRestart &&
				this.stats.restartCount < this.config.maxRestarts
			) {
				this.scheduleRestart();
			}
		}
	}

	private handleClientDisconnect(info: any): void {
		devLog.warn(`${this.config.id} Client disconnected:`, info);

		if (this.status === MCPServerStatus.RUNNING) {
			this.setStatus(MCPServerStatus.CRASHED);

			if (
				this.config.autoRestart &&
				this.stats.restartCount < this.config.maxRestarts
			) {
				this.scheduleRestart();
			}
		}
	}

	private handleStartupTimeout(): void {
		devLog.error(
			`${this.config.id} Startup timeout after ${this.config.startupTimeout}ms`,
		);
		this.setStatus(MCPServerStatus.FAILED);
		this.cleanup();
	}

	private handleStartupError(error: Error): void {
		devLog.error(`${this.config.id} Startup error:`, error);
		this.stats.errorCount++;
		this.stats.lastError = new Date();
		this.setStatus(MCPServerStatus.FAILED);
		this.cleanup();
		this.emit("error", error);
	}

	private handleShutdownTimeout(): void {
		devLog.warn(`${this.config.id} Shutdown timeout, forcing termination`);
		if (this.client) {
			// Force disconnect
			this.client.removeAllListeners();
			this.client = null;
		}
	}

	private scheduleRestart(): void {
		if (this.restartDelay) {
			window.clearTimeout(this.restartDelay);
		}

		this.setStatus(MCPServerStatus.RESTARTING);
		this.stats.restartCount++;
		this.stats.lastRestart = new Date();

		const delay = Math.min(
			1000 * Math.pow(2, this.stats.restartCount),
			30000,
		); // Exponential backoff, max 30s

		this.emit("restart", this.stats.restartCount, this.config.maxRestarts);

		this.restartDelay = window.setTimeout(async () => {
			try {
				await this.start();
			} catch (error) {
				devLog.error(`${this.config.id} Restart failed:`, error);
				this.setStatus(MCPServerStatus.FAILED);
			}
		}, delay);
	}

	private clearTimeouts(): void {
		if (this.startupTimeout) {
			window.clearTimeout(this.startupTimeout);
			this.startupTimeout = null;
		}

		if (this.shutdownTimeout) {
			window.clearTimeout(this.shutdownTimeout);
			this.shutdownTimeout = null;
		}

		if (this.restartDelay) {
			window.clearTimeout(this.restartDelay);
			this.restartDelay = null;
		}
	}

	private getPid(): number | undefined {
		// Try to get PID from the transport if it's stdio
		if (this.client && this.config.transport.type === "stdio") {
			const transport = this.client.transport;
			// Only StdioTransport has a process property
			if (
				transport &&
				typeof transport === "object" &&
				"process" in transport
			) {
				const stdioTransport = transport as unknown as StdioTransport;
				if (stdioTransport.process) {
					return stdioTransport.process.pid;
				}
			}
		}
		return undefined;
	}

	private cleanup(): void {
		this.clearTimeouts();
		this.stopHealthMonitoring();

		if (this.client) {
			this.client.removeAllListeners();
			this.client = null;
		}
	}

	/**
	 * Dispose of the server instance
	 */
	dispose(): void {
		this.stop().catch(console.error);
		this.cleanup();
		this.removeAllListeners();
	}
}
