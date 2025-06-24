/**
 * Configuration interface for MCP servers
 */
export interface MCPServerConfig {
	/** Unique identifier for this server configuration */
	id: string;

	/** Human-readable name for the server */
	name: string;

	/** Description of what this server provides */
	description?: string;

	/** Command to execute to start the server */
	command: string;

	/** Arguments to pass to the command */
	args: string[];

	/** Environment variables to set for the server process */
	env?: Record<string, string>;

	/** Working directory for the server process */
	cwd?: string;

	/** Whether the server should auto-restart on crash */
	autoRestart: boolean;

	/** Maximum number of restart attempts */
	maxRestarts: number;

	/** Timeout for server startup (in milliseconds) */
	startupTimeout: number;

	/** Timeout for server shutdown (in milliseconds) */
	shutdownTimeout: number;

	/** Whether the server is enabled */
	enabled: boolean;

	/** Transport configuration */
	transport: {
		type: "stdio" | "sse";
		url?: string; // For SSE transport
	};

	/** Tags for categorizing servers */
	tags?: string[];

	/** Version of the server (for updates/compatibility) */
	version?: string;

	/** Health check configuration */
	healthCheck?: {
		/** Interval between health checks (in milliseconds) */
		interval: number;
		/** Timeout for health check requests (in milliseconds) */
		timeout: number;
		/** Number of failed checks before marking as unhealthy */
		failureThreshold: number;
	};
}

/**
 * Default configuration values
 */
export const DEFAULT_MCP_SERVER_CONFIG: Partial<MCPServerConfig> = {
	autoRestart: true,
	maxRestarts: 3,
	startupTimeout: 10000, // 10 seconds
	shutdownTimeout: 5000, // 5 seconds
	enabled: true,
	transport: { type: "stdio" },
	env: {},
	args: [],
	healthCheck: {
		interval: 30000, // 30 seconds
		timeout: 5000, // 5 seconds
		failureThreshold: 3,
	},
};

/**
 * Server status enumeration
 */
export enum MCPServerStatus {
	STOPPED = "stopped",
	STARTING = "starting",
	RUNNING = "running",
	STOPPING = "stopping",
	CRASHED = "crashed",
	FAILED = "failed",
	RESTARTING = "restarting",
}

/**
 * Server health status
 */
export enum MCPServerHealth {
	HEALTHY = "healthy",
	UNHEALTHY = "unhealthy",
	UNKNOWN = "unknown",
}

/**
 * Server statistics interface
 */
export interface MCPServerStats {
	/** Process ID */
	pid?: number;

	/** Start time */
	startTime?: Date;

	/** Uptime in milliseconds */
	uptime?: number;

	/** Number of restarts */
	restartCount: number;

	/** Last restart time */
	lastRestart?: Date;

	/** Memory usage in bytes */
	memoryUsage?: number;

	/** CPU usage percentage */
	cpuUsage?: number;

	/** Number of tools discovered */
	toolCount: number;

	/** Last successful tool discovery time */
	lastToolDiscovery?: Date;

	/** Number of tool calls executed */
	toolCallCount: number;

	/** Last tool call time */
	lastToolCall?: Date;

	/** Error count */
	errorCount: number;

	/** Last error time */
	lastError?: Date;
}

/**
 * Validation functions for MCP server configuration
 */
export class MCPServerConfigValidator {
	/**
	 * Validate a complete server configuration
	 */
	static validate(config: Partial<MCPServerConfig>): string[] {
		const errors: string[] = [];

		// Required fields
		if (!config.id) {
			errors.push("Server ID is required");
		} else if (!/^[a-zA-Z0-9_-]+$/.test(config.id)) {
			errors.push(
				"Server ID must contain only alphanumeric characters, hyphens, and underscores"
			);
		}

		if (!config.name) {
			errors.push("Server name is required");
		} else if (config.name.trim().length === 0) {
			errors.push("Server name cannot be empty");
		}

		// Command is only required for STDIO transport
		if (config.transport?.type === "stdio") {
			if (!config.command) {
				errors.push("Server command is required for STDIO transport");
			} else if (config.command.trim().length === 0) {
				errors.push("Server command cannot be empty");
			}
		}

		// Transport validation
		if (config.transport) {
			if (!["stdio", "sse"].includes(config.transport.type)) {
				errors.push('Transport type must be either "stdio" or "sse"');
			}

			if (config.transport.type === "sse" && !config.transport.url) {
				errors.push("URL is required for SSE transport");
			}

			if (
				config.transport.url &&
				!this.isValidUrl(config.transport.url)
			) {
				errors.push("Transport URL must be a valid URL");
			}
		}

		// Numeric validations
		if (
			config.maxRestarts !== undefined &&
			(config.maxRestarts < 0 || config.maxRestarts > 100)
		) {
			errors.push("Max restarts must be between 0 and 100");
		}

		if (
			config.startupTimeout !== undefined &&
			(config.startupTimeout < 1000 || config.startupTimeout > 60000)
		) {
			errors.push("Startup timeout must be between 1 and 60 seconds");
		}

		if (
			config.shutdownTimeout !== undefined &&
			(config.shutdownTimeout < 1000 || config.shutdownTimeout > 30000)
		) {
			errors.push("Shutdown timeout must be between 1 and 30 seconds");
		}

		// Health check validation
		if (config.healthCheck) {
			if (
				config.healthCheck.interval < 5000 ||
				config.healthCheck.interval > 300000
			) {
				errors.push(
					"Health check interval must be between 5 seconds and 5 minutes"
				);
			}

			if (
				config.healthCheck.timeout < 1000 ||
				config.healthCheck.timeout > 30000
			) {
				errors.push(
					"Health check timeout must be between 1 and 30 seconds"
				);
			}

			if (
				config.healthCheck.failureThreshold < 1 ||
				config.healthCheck.failureThreshold > 10
			) {
				errors.push(
					"Health check failure threshold must be between 1 and 10"
				);
			}
		}

		// Environment variables validation
		if (config.env) {
			for (const [key, value] of Object.entries(config.env)) {
				if (typeof key !== "string" || typeof value !== "string") {
					errors.push("Environment variables must be strings");
					break;
				}
			}
		}

		// Arguments validation
		if (config.args && !Array.isArray(config.args)) {
			errors.push("Arguments must be an array of strings");
		} else if (
			config.args &&
			config.args.some((arg) => typeof arg !== "string")
		) {
			errors.push("All arguments must be strings");
		}

		return errors;
	}

	/**
	 * Create a complete configuration with defaults
	 */
	static withDefaults(config: Partial<MCPServerConfig>): MCPServerConfig {
		return {
			...DEFAULT_MCP_SERVER_CONFIG,
			...config,
			healthCheck: {
				...DEFAULT_MCP_SERVER_CONFIG.healthCheck!,
				...config.healthCheck,
			},
		} as MCPServerConfig;
	}

	/**
	 * Validate URL format
	 */
	private static isValidUrl(url: string): boolean {
		try {
			const parsedUrl = new URL(url);
			// Accept HTTP/HTTPS for SSE transport and WS/WSS for WebSocket transport
			return (
				parsedUrl.protocol === "http:" ||
				parsedUrl.protocol === "https:" ||
				parsedUrl.protocol === "ws:" ||
				parsedUrl.protocol === "wss:"
			);
		} catch {
			return false;
		}
	}
}

/**
 * Predefined server configuration templates
 */
export const MCP_SERVER_TEMPLATES: Record<string, Partial<MCPServerConfig>> = {
	"everything-server": {
		name: "Everything Server",
		description: "Test server with various tool examples",
		command: "npx",
		args: ["@modelcontextprotocol/server-everything"],
		tags: ["test", "examples"],
	},

	"filesystem-server": {
		name: "Filesystem Server",
		description: "Server for file system operations",
		command: "npx",
		args: ["@modelcontextprotocol/server-filesystem"],
		tags: ["filesystem", "files"],
	},

	"git-server": {
		name: "Git Server",
		description: "Server for Git operations",
		command: "npx",
		args: ["@modelcontextprotocol/server-git"],
		tags: ["git", "version-control"],
	},

	"postgres-server": {
		name: "PostgreSQL Server",
		description: "Server for PostgreSQL database operations",
		command: "npx",
		args: ["@modelcontextprotocol/server-postgres"],
		tags: ["database", "postgresql"],
	},
};
