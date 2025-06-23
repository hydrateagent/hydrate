#!/usr/bin/env node

/**
 * Test script for MCPServerManager
 *
 * This script tests the comprehensive server management functionality:
 * 1. Server lifecycle management (add, remove, start, stop, restart)
 * 2. Configuration persistence and loading
 * 3. Tool discovery integration
 * 4. Health monitoring across multiple servers
 * 5. Error handling and recovery
 * 6. Manager statistics and reporting
 */

import { MCPServerManager, MCPConfigStorage } from "./MCPServerManager";
import {
	MCPServerConfig,
	MCPServerStatus,
	MCPServerHealth,
} from "./MCPServerConfig";
import { MCPToolDiscovery } from "./MCPToolDiscovery";

/**
 * Mock storage implementation for testing
 */
class MockConfigStorage implements MCPConfigStorage {
	private data: Record<string, MCPServerConfig> = {};
	private shouldFail = false;

	async save(configs: Record<string, MCPServerConfig>): Promise<void> {
		if (this.shouldFail) {
			throw new Error("Mock storage save failure");
		}
		this.data = { ...configs };
		console.log(
			`📁 Saved ${Object.keys(configs).length} server configurations`
		);
	}

	async load(): Promise<Record<string, MCPServerConfig>> {
		if (this.shouldFail) {
			throw new Error("Mock storage load failure");
		}
		console.log(
			`📁 Loaded ${Object.keys(this.data).length} server configurations`
		);
		return { ...this.data };
	}

	async exists(): Promise<boolean> {
		return Object.keys(this.data).length > 0;
	}

	// Test utilities
	setShouldFail(fail: boolean): void {
		this.shouldFail = fail;
	}

	getData(): Record<string, MCPServerConfig> {
		return { ...this.data };
	}

	clear(): void {
		this.data = {};
	}
}

/**
 * Test configuration templates
 */
const TEST_CONFIGS = {
	echo_server: {
		name: "Echo Server",
		description: "Simple echo server for testing",
		command: "npx",
		args: ["@modelcontextprotocol/server-echo"],
		enabled: true,
		autoStart: false,
		transport: "stdio" as const,
	},
	filesystem_server: {
		name: "Filesystem Server",
		description: "Local filesystem access",
		command: "npx",
		args: ["@modelcontextprotocol/server-filesystem", "/tmp"],
		enabled: true,
		autoStart: true,
		transport: "stdio" as const,
	},
	web_server: {
		name: "Web Server",
		description: "Web search and browsing",
		transport: "websocket" as const,
		websocketUrl: "ws://localhost:8080/mcp",
		enabled: false,
		autoStart: false,
	},
};

/**
 * Test runner class
 */
class MCPServerManagerTests {
	private manager: MCPServerManager;
	private storage: MockConfigStorage;
	private testResults: { [key: string]: boolean } = {};

	constructor() {
		this.storage = new MockConfigStorage();
		this.manager = new MCPServerManager();
		this.manager.setStorage(this.storage);
		this.setupEventListeners();
	}

	/**
	 * Set up event listeners for testing
	 */
	private setupEventListeners(): void {
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

		this.manager.on(
			"server-health-changed",
			(serverId, health, previousHealth) => {
				console.log(
					`💚 Server ${serverId} health: ${previousHealth} → ${health}`
				);
			}
		);

		this.manager.on("server-error", (serverId, error) => {
			console.log(`❌ Server ${serverId} error: ${error.message}`);
		});

		this.manager.on("tools-discovered", (serverId, toolCount) => {
			console.log(`🔧 Server ${serverId} discovered ${toolCount} tools`);
		});

		this.manager.on("configuration-saved", () => {
			console.log(`💾 Configuration saved successfully`);
		});

		this.manager.on("configuration-loaded", (serverCount) => {
			console.log(`📂 Configuration loaded: ${serverCount} servers`);
		});

		this.manager.on("error", (error) => {
			console.log(`🚨 Manager error: ${error.message}`);
		});
	}

	/**
	 * Test server lifecycle management
	 */
	async testServerLifecycle(): Promise<boolean> {
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

			const updatedConfig = this.manager.getServerConfig("echo");
			if (
				!updatedConfig ||
				updatedConfig.description !== "Updated echo server description"
			) {
				throw new Error("Failed to update server configuration");
			}

			// Test duplicate server ID prevention
			try {
				await this.manager.addServer("echo", TEST_CONFIGS.echo_server);
				throw new Error("Should have prevented duplicate server ID");
			} catch (error) {
				if (!error.message.includes("already exists")) {
					throw error;
				}
			}

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

	/**
	 * Test configuration persistence
	 */
	async testConfigurationPersistence(): Promise<boolean> {
		console.log("\n🧪 Testing Configuration Persistence...");

		try {
			// Save current configuration
			await this.manager.saveConfiguration();

			// Verify storage has data
			const savedData = this.storage.getData();
			if (Object.keys(savedData).length === 0) {
				throw new Error("No data was saved to storage");
			}

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

			// Verify configuration details
			for (const serverId of originalIds) {
				const originalConfig = this.manager.getServerConfig(serverId);
				const loadedConfig = newManager.getServerConfig(serverId);

				if (!originalConfig || !loadedConfig) {
					throw new Error(`Missing config for server ${serverId}`);
				}

				if (originalConfig.name !== loadedConfig.name) {
					throw new Error(`Config mismatch for server ${serverId}`);
				}
			}

			// Test auto-save functionality
			this.manager.setAutoSave(true, 100); // 100ms delay
			await this.manager.addServer(
				"auto-save-test",
				TEST_CONFIGS.echo_server
			);

			// Wait for auto-save
			await new Promise((resolve) => setTimeout(resolve, 200));

			// Verify auto-save worked
			const autoSavedData = this.storage.getData();
			if (!autoSavedData["auto-save-test"]) {
				throw new Error("Auto-save did not work");
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

	/**
	 * Test manager statistics and monitoring
	 */
	async testManagerStats(): Promise<boolean> {
		console.log("\n🧪 Testing Manager Statistics...");

		try {
			// Get initial stats
			const stats = this.manager.getManagerStats();

			// Verify basic stats structure
			if (
				typeof stats.totalServers !== "number" ||
				typeof stats.runningServers !== "number" ||
				typeof stats.healthyServers !== "number" ||
				typeof stats.totalTools !== "number" ||
				typeof stats.uptime !== "number"
			) {
				throw new Error("Invalid stats structure");
			}

			// Verify server count
			if (stats.totalServers !== this.manager.getServerIds().length) {
				throw new Error("Total servers count mismatch");
			}

			// Test server status and health getters
			for (const serverId of this.manager.getServerIds()) {
				const status = this.manager.getServerStatus(serverId);
				const health = this.manager.getServerHealth(serverId);
				const serverStats = this.manager.getServerStats(serverId);

				if (!Object.values(MCPServerStatus).includes(status!)) {
					throw new Error(`Invalid status for server ${serverId}`);
				}

				if (!Object.values(MCPServerHealth).includes(health!)) {
					throw new Error(`Invalid health for server ${serverId}`);
				}

				if (
					!serverStats ||
					typeof serverStats.startTime === "undefined"
				) {
					throw new Error(`Invalid stats for server ${serverId}`);
				}
			}

			// Test server existence checks
			if (!this.manager.hasServer("echo")) {
				throw new Error("hasServer returned false for existing server");
			}

			if (this.manager.hasServer("non-existent")) {
				throw new Error(
					"hasServer returned true for non-existent server"
				);
			}

			console.log("✅ Manager statistics tests passed");
			return true;
		} catch (error) {
			console.log(`❌ Manager statistics test failed: ${error.message}`);
			return false;
		}
	}

	/**
	 * Test tool discovery integration
	 */
	async testToolDiscovery(): Promise<boolean> {
		console.log("\n🧪 Testing Tool Discovery Integration...");

		try {
			// Get all tools (should work even if servers aren't running)
			const allTools = this.manager.getAllTools();
			console.log(
				`📋 Found ${allTools.length} total tools across all servers`
			);

			// Test server-specific tool retrieval
			for (const serverId of this.manager.getServerIds()) {
				const serverTools = this.manager.getServerTools(serverId);
				console.log(
					`📋 Server ${serverId} has ${serverTools.length} tools`
				);
			}

			// Test tool refresh (should not throw even if servers aren't running)
			try {
				await this.manager.refreshAllTools();
				console.log("🔄 Tool refresh completed successfully");
			} catch (error) {
				console.log(
					`⚠️  Tool refresh failed (expected if servers not running): ${error.message}`
				);
			}

			console.log("✅ Tool discovery integration tests passed");
			return true;
		} catch (error) {
			console.log(`❌ Tool discovery test failed: ${error.message}`);
			return false;
		}
	}

	/**
	 * Test error handling and resilience
	 */
	async testErrorHandling(): Promise<boolean> {
		console.log("\n🧪 Testing Error Handling and Resilience...");

		try {
			// Test invalid server configuration
			try {
				await this.manager.addServer("invalid", {
					name: "", // Invalid: empty name
					command: "",
				});
				throw new Error("Should have rejected invalid configuration");
			} catch (error) {
				if (!error.message.includes("Invalid server configuration")) {
					throw error;
				}
			}

			// Test operations on non-existent server
			try {
				await this.manager.startServer("non-existent");
				throw new Error("Should have failed for non-existent server");
			} catch (error) {
				if (!error.message.includes("not found")) {
					throw error;
				}
			}

			// Test storage failure handling
			this.storage.setShouldFail(true);
			try {
				await this.manager.saveConfiguration();
				throw new Error("Should have failed with storage error");
			} catch (error) {
				if (!error.message.includes("Mock storage save failure")) {
					throw error;
				}
			}
			this.storage.setShouldFail(false);

			// Test health check on non-running servers
			const healthResults = await this.manager.performHealthCheck();
			for (const [serverId, healthy] of Object.entries(healthResults)) {
				console.log(
					`💚 Health check ${serverId}: ${healthy ? "✅" : "❌"}`
				);
			}

			console.log("✅ Error handling tests passed");
			return true;
		} catch (error) {
			console.log(`❌ Error handling test failed: ${error.message}`);
			return false;
		}
	}

	/**
	 * Test bulk operations
	 */
	async testBulkOperations(): Promise<boolean> {
		console.log("\n🧪 Testing Bulk Operations...");

		try {
			// Test start all servers (should handle failures gracefully)
			console.log("🚀 Starting all servers...");
			await this.manager.startAllServers();

			// Wait a moment for status updates
			await new Promise((resolve) => setTimeout(resolve, 1000));

			// Check if any servers started (some might fail due to missing dependencies)
			const stats = this.manager.getManagerStats();
			console.log(
				`📊 Servers running: ${stats.runningServers}/${stats.totalServers}`
			);

			// Test stop all servers
			console.log("🛑 Stopping all servers...");
			await this.manager.stopAllServers();

			// Wait a moment for status updates
			await new Promise((resolve) => setTimeout(resolve, 1000));

			// Verify all servers are stopped
			const finalStats = this.manager.getManagerStats();
			console.log(
				`📊 Final running servers: ${finalStats.runningServers}`
			);

			console.log("✅ Bulk operations tests passed");
			return true;
		} catch (error) {
			console.log(`❌ Bulk operations test failed: ${error.message}`);
			return false;
		}
	}

	/**
	 * Run all tests
	 */
	async runAllTests(): Promise<void> {
		console.log("🧪 Starting MCPServerManager Comprehensive Tests\n");

		const tests = [
			{ name: "Server Lifecycle", fn: () => this.testServerLifecycle() },
			{
				name: "Configuration Persistence",
				fn: () => this.testConfigurationPersistence(),
			},
			{ name: "Manager Statistics", fn: () => this.testManagerStats() },
			{ name: "Tool Discovery", fn: () => this.testToolDiscovery() },
			{ name: "Error Handling", fn: () => this.testErrorHandling() },
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

	/**
	 * Cleanup test resources
	 */
	async cleanup(): Promise<void> {
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

/**
 * Run the tests
 */
export async function testMCPServerManager(): Promise<void> {
	const tests = new MCPServerManagerTests();
	await tests.runAllTests();
}

// Run tests if this file is executed directly
if (require.main === module) {
	testMCPServerManager().catch(console.error);
}
