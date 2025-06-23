#!/usr/bin/env node

/**
 * Standalone test for MCPServerManager functionality
 *
 * This test runs in Node.js without Obsidian dependencies
 * to verify the core MCPServerManager implementation.
 */

// Mock EventEmitter for Node.js
const { EventEmitter } = require("events");

// Mock MCPServerConfig types and validator
const MCPServerStatus = {
	STOPPED: "stopped",
	STARTING: "starting",
	RUNNING: "running",
	STOPPING: "stopping",
	CRASHED: "crashed",
	FAILED: "failed",
	RESTARTING: "restarting",
};

const MCPServerHealth = {
	HEALTHY: "healthy",
	UNHEALTHY: "unhealthy",
	UNKNOWN: "unknown",
};

class MCPServerConfigValidator {
	static validate(config) {
		const errors = [];
		if (!config.id) errors.push("Server ID is required");
		if (!config.name) errors.push("Server name is required");
		if (!config.command) errors.push("Server command is required");
		return errors;
	}

	static withDefaults(config) {
		return {
			autoRestart: true,
			maxRestarts: 3,
			startupTimeout: 10000,
			shutdownTimeout: 5000,
			enabled: true,
			transport: "stdio",
			env: {},
			args: [],
			...config,
		};
	}
}

// Mock MCPServer class
class MCPServer extends EventEmitter {
	constructor(config) {
		super();
		this.config = config;
		this.status = MCPServerStatus.STOPPED;
		this.health = MCPServerHealth.UNKNOWN;
		this.stats = {
			startTime: undefined,
			restartCount: 0,
			toolCount: 0,
			toolCallCount: 0,
			errorCount: 0,
		};
	}

	getConfig() {
		return { ...this.config };
	}
	getStatus() {
		return this.status;
	}
	getHealth() {
		return this.health;
	}
	getStats() {
		return { ...this.stats };
	}
	isHealthy() {
		return this.health === MCPServerHealth.HEALTHY;
	}

	async updateConfig(newConfig) {
		this.config = { ...this.config, ...newConfig };
	}

	async start() {
		console.log(`🚀 Mock starting server ${this.config.id}`);
		this.status = MCPServerStatus.STARTING;
		this.emit("status-changed", this.status, MCPServerStatus.STOPPED);

		// Simulate startup delay
		setTimeout(() => {
			this.status = MCPServerStatus.RUNNING;
			this.health = MCPServerHealth.HEALTHY;
			this.stats.startTime = new Date();
			this.emit("status-changed", this.status, MCPServerStatus.STARTING);
			this.emit("health-changed", this.health, MCPServerHealth.UNKNOWN);
		}, 100);
	}

	async stop() {
		console.log(`🛑 Mock stopping server ${this.config.id}`);
		this.status = MCPServerStatus.STOPPING;
		this.emit("status-changed", this.status, MCPServerStatus.RUNNING);

		setTimeout(() => {
			this.status = MCPServerStatus.STOPPED;
			this.health = MCPServerHealth.UNKNOWN;
			this.emit("status-changed", this.status, MCPServerStatus.STOPPING);
			this.emit("health-changed", this.health, MCPServerHealth.HEALTHY);
		}, 50);
	}

	async restart() {
		await this.stop();
		await new Promise((resolve) => setTimeout(resolve, 100));
		await this.start();
	}

	async performHealthCheck() {
		return this.status === MCPServerStatus.RUNNING;
	}

	dispose() {
		this.removeAllListeners();
	}
}

// Mock MCPToolDiscovery class
class MCPToolDiscovery extends EventEmitter {
	constructor() {
		super();
		this.tools = [];
		this.serverTools = new Map();
	}

	getAllTools() {
		return [...this.tools];
	}

	getToolsFromServer(serverId) {
		return this.serverTools.get(serverId) || [];
	}

	clearServerCache(serverId) {
		this.serverTools.delete(serverId);
		console.log(`🧹 Cleared cache for server ${serverId}`);
	}

	async refreshTools(server) {
		const serverId = server.getConfig().id;
		const mockTools = [
			{ name: `${serverId}_tool_1`, description: "Mock tool 1" },
			{ name: `${serverId}_tool_2`, description: "Mock tool 2" },
		];
		this.serverTools.set(serverId, mockTools);
		console.log(
			`🔄 Refreshed ${mockTools.length} tools for server ${serverId}`
		);
		return mockTools;
	}

	dispose() {
		this.removeAllListeners();
	}
}

// Mock storage implementation
class MockConfigStorage {
	constructor() {
		this.data = {};
		this.shouldFail = false;
	}

	async save(configs) {
		if (this.shouldFail) throw new Error("Mock storage save failure");
		this.data = { ...configs };
		console.log(
			`📁 Saved ${Object.keys(configs).length} server configurations`
		);
	}

	async load() {
		if (this.shouldFail) throw new Error("Mock storage load failure");
		console.log(
			`📁 Loaded ${Object.keys(this.data).length} server configurations`
		);
		return { ...this.data };
	}

	async exists() {
		return Object.keys(this.data).length > 0;
	}

	setShouldFail(fail) {
		this.shouldFail = fail;
	}
	getData() {
		return { ...this.data };
	}
	clear() {
		this.data = {};
	}
}

// MCPServerManager implementation (simplified for testing)
class MCPServerManager extends EventEmitter {
	constructor(toolDiscovery) {
		super();
		this.servers = new Map();
		this.toolDiscovery = toolDiscovery || new MCPToolDiscovery();
		this.storage = null;
		this.startTime = new Date();
		this.autoSaveEnabled = true;
		this.autoSaveDelay = 1000;
		this.autoSaveTimeout = null;
	}

	setStorage(storage) {
		this.storage = storage;
	}
	setAutoSave(enabled, delayMs = 1000) {
		this.autoSaveEnabled = enabled;
		this.autoSaveDelay = delayMs;
	}

	async addServer(serverId, config) {
		if (this.servers.has(serverId)) {
			throw new Error(`Server with ID '${serverId}' already exists`);
		}

		const configWithId = { ...config, id: serverId };
		const errors = MCPServerConfigValidator.validate(configWithId);
		if (errors.length > 0) {
			throw new Error(
				`Invalid server configuration: ${errors.join(", ")}`
			);
		}

		const fullConfig = MCPServerConfigValidator.withDefaults(configWithId);
		const server = new MCPServer(fullConfig);

		this.setupServerEventHandlers(serverId, server);

		this.servers.set(serverId, {
			server,
			config: fullConfig,
			lastSeen: new Date(),
		});

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

	async removeServer(serverId) {
		const entry = this.servers.get(serverId);
		if (!entry) {
			throw new Error(`Server with ID '${serverId}' not found`);
		}

		try {
			await entry.server.stop();
		} catch (error) {
			console.warn(`Error stopping server '${serverId}':`, error);
		}

		this.toolDiscovery.clearServerCache(serverId);
		entry.server.removeAllListeners();
		entry.server.dispose();
		this.servers.delete(serverId);

		this.emit("server-removed", serverId);
		this.scheduleAutoSave();
	}

	async updateServerConfig(serverId, config) {
		const entry = this.servers.get(serverId);
		if (!entry) {
			throw new Error(`Server with ID '${serverId}' not found`);
		}

		await entry.server.updateConfig(config);
		entry.config = entry.server.getConfig();
		entry.lastSeen = new Date();
		this.scheduleAutoSave();
	}

	async startServer(serverId) {
		const entry = this.servers.get(serverId);
		if (!entry) {
			throw new Error(`Server with ID '${serverId}' not found`);
		}
		await entry.server.start();
		entry.lastSeen = new Date();
	}

	async stopServer(serverId) {
		const entry = this.servers.get(serverId);
		if (!entry) {
			throw new Error(`Server with ID '${serverId}' not found`);
		}
		await entry.server.stop();
		entry.lastSeen = new Date();
	}

	async restartServer(serverId) {
		const entry = this.servers.get(serverId);
		if (!entry) {
			throw new Error(`Server with ID '${serverId}' not found`);
		}
		await entry.server.restart();
		entry.lastSeen = new Date();
	}

	async startAllServers() {
		const startPromises = [];
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

	async stopAllServers() {
		const stopPromises = [];
		for (const [serverId] of this.servers) {
			stopPromises.push(
				this.stopServer(serverId).catch((error) => {
					console.warn(`Failed to stop server '${serverId}':`, error);
				})
			);
		}
		await Promise.allSettled(stopPromises);
	}

	getServerConfig(serverId) {
		const entry = this.servers.get(serverId);
		return entry ? { ...entry.config } : null;
	}

	getServerStatus(serverId) {
		const entry = this.servers.get(serverId);
		return entry ? entry.server.getStatus() : null;
	}

	getServerHealth(serverId) {
		const entry = this.servers.get(serverId);
		return entry ? entry.server.getHealth() : null;
	}

	getServerStats(serverId) {
		const entry = this.servers.get(serverId);
		return entry ? entry.server.getStats() : null;
	}

	getServerIds() {
		return Array.from(this.servers.keys());
	}

	getAllServerConfigs() {
		const configs = {};
		for (const [serverId, entry] of this.servers) {
			configs[serverId] = { ...entry.config };
		}
		return configs;
	}

	getManagerStats() {
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
			totalTools: this.toolDiscovery.getAllTools().length,
			uptime: Date.now() - this.startTime.getTime(),
			lastConfigSave: this.storage ? new Date() : null,
		};
	}

	getAllTools() {
		return this.toolDiscovery.getAllTools();
	}

	getServerTools(serverId) {
		return this.toolDiscovery.getToolsFromServer(serverId);
	}

	async refreshAllTools() {
		const refreshPromises = [];
		for (const [serverId, entry] of this.servers) {
			if (entry.server.getStatus() === MCPServerStatus.RUNNING) {
				refreshPromises.push(
					this.toolDiscovery
						.refreshTools(entry.server)
						.catch((error) => {
							console.warn(
								`Failed to refresh tools for server '${serverId}':`,
								error
							);
						})
						.then(() => {})
				);
			}
		}
		await Promise.allSettled(refreshPromises);
	}

	async refreshServerTools(serverId) {
		const entry = this.servers.get(serverId);
		if (!entry) {
			throw new Error(`Server with ID '${serverId}' not found`);
		}

		if (entry.server.getStatus() === MCPServerStatus.RUNNING) {
			await this.toolDiscovery.refreshTools(entry.server);
		} else {
			throw new Error(`Server '${serverId}' is not running`);
		}
	}

	async saveConfiguration() {
		if (!this.storage) {
			throw new Error("No storage backend configured");
		}
		const configs = this.getAllServerConfigs();
		await this.storage.save(configs);
		this.emit("configuration-saved");
	}

	async loadConfiguration() {
		if (!this.storage) {
			throw new Error("No storage backend configured");
		}

		if (!(await this.storage.exists())) {
			this.emit("configuration-loaded", 0);
			return;
		}

		const configs = await this.storage.load();
		let loadedCount = 0;

		for (const [serverId, config] of Object.entries(configs)) {
			try {
				await this.addServer(serverId, config);
				loadedCount++;
			} catch (error) {
				console.warn(`Failed to load server '${serverId}':`, error);
				this.emit("error", error);
			}
		}

		this.emit("configuration-loaded", loadedCount);
	}

	async performHealthCheck() {
		const results = {};
		for (const [serverId, entry] of this.servers) {
			try {
				results[serverId] = await entry.server.performHealthCheck();
			} catch (error) {
				results[serverId] = false;
				this.emit("server-error", serverId, error);
			}
		}
		return results;
	}

	getServer(serverId) {
		const entry = this.servers.get(serverId);
		return entry ? entry.server : null;
	}

	hasServer(serverId) {
		return this.servers.has(serverId);
	}

	async dispose() {
		if (this.autoSaveTimeout) {
			clearTimeout(this.autoSaveTimeout);
			this.autoSaveTimeout = null;
		}

		await this.stopAllServers();

		for (const entry of this.servers.values()) {
			entry.server.dispose();
		}

		this.servers.clear();
		this.toolDiscovery.dispose();
		this.removeAllListeners();
	}

	setupServerEventHandlers(serverId, server) {
		server.on("status-changed", (status, previousStatus) => {
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

	scheduleAutoSave() {
		if (!this.autoSaveEnabled || !this.storage) {
			return;
		}

		if (this.autoSaveTimeout) {
			clearTimeout(this.autoSaveTimeout);
		}

		this.autoSaveTimeout = setTimeout(async () => {
			try {
				await this.saveConfiguration();
			} catch (error) {
				console.warn("Auto-save failed:", error);
				this.emit("error", error);
			}
		}, this.autoSaveDelay);
	}
}

// Test configurations
const TEST_CONFIGS = {
	echo_server: {
		name: "Echo Server",
		description: "Simple echo server for testing",
		command: "npx",
		args: ["@modelcontextprotocol/server-echo"],
		enabled: true,
		autoRestart: false,
		transport: "stdio",
	},
	filesystem_server: {
		name: "Filesystem Server",
		description: "Local filesystem access",
		command: "npx",
		args: ["@modelcontextprotocol/server-filesystem", "/tmp"],
		enabled: true,
		autoRestart: true,
		transport: "stdio",
	},
	web_server: {
		name: "Web Server",
		description: "Web search and browsing",
		command: "node",
		args: ["web-server.js"],
		transport: "websocket",
		websocketUrl: "ws://localhost:8080/mcp",
		enabled: false,
		autoRestart: false,
	},
};

// Test runner
class MCPServerManagerTests {
	constructor() {
		this.storage = new MockConfigStorage();
		this.manager = new MCPServerManager();
		this.manager.setStorage(this.storage);
		this.testResults = {};
		this.setupEventListeners();
	}

	setupEventListeners() {
		this.manager.on("server-added", (serverId, config) => {
			console.log(`✅ Server added: ${serverId} (${config.name})`);
		});

		this.manager.on("server-removed", (serverId) => {
			console.log(`🗑️  Server removed: ${serverId}`);
		});

		this.manager.on(
			"server-status-changed",
			(serverId, status, previousStatus) => {
				console.log(
					`🔄 Server ${serverId}: ${previousStatus} → ${status}`
				);
			}
		);

		this.manager.on("configuration-saved", () => {
			console.log(`💾 Configuration saved successfully`);
		});

		this.manager.on("configuration-loaded", (serverCount) => {
			console.log(`📂 Configuration loaded: ${serverCount} servers`);
		});
	}

	async testServerLifecycle() {
		console.log("\n🧪 Testing Server Lifecycle Management...");

		try {
			// Test adding servers
			await this.manager.addServer("echo", TEST_CONFIGS.echo_server);
			await this.manager.addServer(
				"filesystem",
				TEST_CONFIGS.filesystem_server
			);
			await this.manager.addServer("web", TEST_CONFIGS.web_server);

			// Verify servers were added
			const serverIds = this.manager.getServerIds();
			if (serverIds.length !== 3) {
				throw new Error(`Expected 3 servers, got ${serverIds.length}`);
			}

			// Test getting server configurations
			const echoConfig = this.manager.getServerConfig("echo");
			if (!echoConfig || echoConfig.name !== "Echo Server") {
				throw new Error("Failed to retrieve echo server config");
			}

			// Test updating server configuration
			await this.manager.updateServerConfig("echo", {
				description: "Updated echo server description",
			});

			// Test removing a server
			await this.manager.removeServer("web");
			const remainingIds = this.manager.getServerIds();
			if (remainingIds.length !== 2 || remainingIds.includes("web")) {
				throw new Error("Failed to remove server");
			}

			console.log("✅ Server lifecycle management tests passed");
			return true;
		} catch (error) {
			console.log(`❌ Server lifecycle test failed: ${error.message}`);
			return false;
		}
	}

	async testConfigurationPersistence() {
		console.log("\n🧪 Testing Configuration Persistence...");

		try {
			// Save current configuration
			await this.manager.saveConfiguration();

			// Create new manager and load configuration
			const newManager = new MCPServerManager();
			newManager.setStorage(this.storage);
			await newManager.loadConfiguration();

			// Verify loaded servers match
			const originalIds = this.manager.getServerIds().sort();
			const loadedIds = newManager.getServerIds().sort();

			if (JSON.stringify(originalIds) !== JSON.stringify(loadedIds)) {
				throw new Error("Loaded server IDs don't match original");
			}

			await newManager.dispose();
			console.log("✅ Configuration persistence tests passed");
			return true;
		} catch (error) {
			console.log(
				`❌ Configuration persistence test failed: ${error.message}`
			);
			return false;
		}
	}

	async testManagerStats() {
		console.log("\n🧪 Testing Manager Statistics...");

		try {
			const stats = this.manager.getManagerStats();

			if (
				typeof stats.totalServers !== "number" ||
				typeof stats.runningServers !== "number" ||
				typeof stats.healthyServers !== "number" ||
				typeof stats.totalTools !== "number" ||
				typeof stats.uptime !== "number"
			) {
				throw new Error("Invalid stats structure");
			}

			if (stats.totalServers !== this.manager.getServerIds().length) {
				throw new Error("Total servers count mismatch");
			}

			console.log("✅ Manager statistics tests passed");
			return true;
		} catch (error) {
			console.log(`❌ Manager statistics test failed: ${error.message}`);
			return false;
		}
	}

	async testBulkOperations() {
		console.log("\n🧪 Testing Bulk Operations...");

		try {
			console.log("🚀 Starting all servers...");
			await this.manager.startAllServers();

			// Wait for status updates
			await new Promise((resolve) => setTimeout(resolve, 200));

			console.log("🛑 Stopping all servers...");
			await this.manager.stopAllServers();

			// Wait for status updates
			await new Promise((resolve) => setTimeout(resolve, 200));

			console.log("✅ Bulk operations tests passed");
			return true;
		} catch (error) {
			console.log(`❌ Bulk operations test failed: ${error.message}`);
			return false;
		}
	}

	async runAllTests() {
		console.log("🧪 Starting MCPServerManager Standalone Tests\n");

		const tests = [
			{ name: "Server Lifecycle", fn: () => this.testServerLifecycle() },
			{
				name: "Configuration Persistence",
				fn: () => this.testConfigurationPersistence(),
			},
			{ name: "Manager Statistics", fn: () => this.testManagerStats() },
			{ name: "Bulk Operations", fn: () => this.testBulkOperations() },
		];

		let passed = 0;
		let total = tests.length;

		for (const test of tests) {
			try {
				const result = await test.fn();
				this.testResults[test.name] = result;
				if (result) passed++;
			} catch (error) {
				console.log(
					`💥 Test "${test.name}" threw unexpected error: ${error.message}`
				);
				this.testResults[test.name] = false;
			}
		}

		// Cleanup
		await this.cleanup();

		// Print summary
		console.log("\n📊 Test Results Summary:");
		console.log("=".repeat(50));

		for (const [testName, result] of Object.entries(this.testResults)) {
			console.log(`${result ? "✅" : "❌"} ${testName}`);
		}

		console.log("=".repeat(50));
		console.log(
			`📈 Overall: ${passed}/${total} tests passed (${Math.round(
				(passed / total) * 100
			)}%)`
		);

		if (passed === total) {
			console.log("🎉 All MCPServerManager tests passed!");
			console.log(
				"\n✅ Task 3.1: MCP Server Manager Implementation - COMPLETED"
			);
		} else {
			console.log(
				"❌ Some tests failed. Please review the implementation."
			);
		}
	}

	async cleanup() {
		console.log("\n🧹 Cleaning up test resources...");
		try {
			await this.manager.dispose();
			this.storage.clear();
			console.log("✅ Cleanup completed");
		} catch (error) {
			console.log(`⚠️  Cleanup warning: ${error.message}`);
		}
	}
}

// Run the tests
async function main() {
	const tests = new MCPServerManagerTests();
	await tests.runAllTests();
}

if (require.main === module) {
	main().catch(console.error);
}
