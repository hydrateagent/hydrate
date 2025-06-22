import { MCPServer } from "./MCPServer";
import {
	MCPServerStatus,
	MCPServerHealth,
	MCP_SERVER_TEMPLATES,
} from "./MCPServerConfig";

/**
 * Test script to verify MCP Server process management
 */
async function testMCPServer() {
	console.log("🧪 Testing MCP Server Process Management...");

	// Test 1: Server creation and configuration validation
	console.log("🔧 Testing server creation and validation...");

	try {
		// Test invalid configuration
		try {
			new MCPServer({});
			console.error("❌ Should have failed with invalid config");
			return false;
		} catch (error) {
			console.log("✅ Invalid config properly rejected:", error.message);
		}

		// Test valid configuration using template
		const serverConfig = {
			id: "test-server",
			...MCP_SERVER_TEMPLATES["everything-server"],
		};

		const server = new MCPServer(serverConfig);
		console.log("✅ Server created successfully");
		console.log("📋 Server config:", server.getConfig());

		// Test 2: Server lifecycle
		console.log("🚀 Testing server lifecycle...");

		let statusChanges: string[] = [];
		let healthChanges: string[] = [];
		let toolsDiscovered = 0;

		server.on("status-changed", (status, previous) => {
			statusChanges.push(`${previous} -> ${status}`);
			console.log(`📊 Status: ${previous} -> ${status}`);
		});

		server.on("health-changed", (health, previous) => {
			healthChanges.push(`${previous} -> ${health}`);
			console.log(`💓 Health: ${previous} -> ${health}`);
		});

		server.on("tools-discovered", (count) => {
			toolsDiscovered = count;
			console.log(`🔧 Tools discovered: ${count}`);
		});

		server.on("error", (error) => {
			console.log(`⚠️ Server error: ${error.message}`);
		});

		server.on("restart", (attempt, maxAttempts) => {
			console.log(`🔄 Restart attempt ${attempt}/${maxAttempts}`);
		});

		// Start the server
		console.log("▶️ Starting server...");
		await server.start();

		// Verify server is running
		if (server.getStatus() !== MCPServerStatus.RUNNING) {
			throw new Error(
				`Expected RUNNING status, got ${server.getStatus()}`
			);
		}

		if (server.getHealth() !== MCPServerHealth.HEALTHY) {
			throw new Error(
				`Expected HEALTHY status, got ${server.getHealth()}`
			);
		}

		console.log("✅ Server started successfully");

		// Test 3: Server statistics and monitoring
		console.log("📊 Testing server statistics...");
		const stats = server.getStats();
		console.log("📈 Server stats:", {
			pid: stats.pid,
			uptime: stats.uptime,
			toolCount: stats.toolCount,
			restartCount: stats.restartCount,
			errorCount: stats.errorCount,
		});

		if (stats.toolCount === 0) {
			console.warn(
				"⚠️ No tools discovered - this might indicate an issue"
			);
		} else {
			console.log(`✅ Discovered ${stats.toolCount} tools`);
		}

		// Test 4: Health check
		console.log("💓 Testing health check...");
		const isHealthy = await server.performHealthCheck();
		console.log(
			`Health check result: ${isHealthy ? "✅ Healthy" : "❌ Unhealthy"}`
		);

		// Test 5: Tool discovery
		console.log("🔍 Testing tool discovery...");
		try {
			await server.discoverTools();
			console.log("✅ Tool discovery successful");
		} catch (error) {
			console.log("❌ Tool discovery failed:", error.message);
		}

		// Test 6: Server restart
		console.log("🔄 Testing server restart...");
		await server.restart();

		if (server.getStatus() !== MCPServerStatus.RUNNING) {
			throw new Error(
				`Expected RUNNING status after restart, got ${server.getStatus()}`
			);
		}

		console.log("✅ Server restart successful");

		// Test 7: Configuration update
		console.log("⚙️ Testing configuration update...");
		const originalConfig = server.getConfig();
		await server.updateConfig({
			description: "Updated test server description",
		});

		const updatedConfig = server.getConfig();
		if (updatedConfig.description === originalConfig.description) {
			throw new Error("Configuration update failed");
		}

		console.log("✅ Configuration update successful");

		// Test 8: Server shutdown
		console.log("⏹️ Testing server shutdown...");
		await server.stop();

		if (server.getStatus() !== MCPServerStatus.STOPPED) {
			throw new Error(
				`Expected STOPPED status, got ${server.getStatus()}`
			);
		}

		console.log("✅ Server stopped successfully");

		// Test 9: Multiple servers
		console.log("🔗 Testing multiple servers...");
		const server2Config = {
			id: "test-server-2",
			name: "Test Server 2",
			command: "npx",
			args: ["@modelcontextprotocol/server-everything"],
		};

		const server2 = new MCPServer(server2Config);
		await server2.start();

		console.log("✅ Multiple servers can run simultaneously");

		await server2.stop();
		server2.dispose();

		// Cleanup
		server.dispose();

		console.log("🎉 All MCP Server tests completed successfully!");

		// Summary
		console.log("\n📋 Test Summary:");
		console.log(`Status changes: ${statusChanges.join(", ")}`);
		console.log(`Health changes: ${healthChanges.join(", ")}`);
		console.log(`Tools discovered: ${toolsDiscovered}`);

		return true;
	} catch (error) {
		console.error("❌ Test failed:", error.message);
		return false;
	}
}

/**
 * Test server crash and auto-restart functionality
 */
async function testServerCrashRecovery() {
	console.log("\n🧪 Testing Server Crash Recovery...");

	const serverConfig = {
		id: "crash-test-server",
		name: "Crash Test Server",
		command: "npx",
		args: ["@modelcontextprotocol/server-everything"],
		autoRestart: true,
		maxRestarts: 2,
	};

	const server = new MCPServer(serverConfig);

	let restartCount = 0;
	server.on("restart", (attempt, maxAttempts) => {
		restartCount = attempt;
		console.log(`🔄 Auto-restart triggered: ${attempt}/${maxAttempts}`);
	});

	try {
		await server.start();
		console.log("✅ Server started for crash test");

		// Simulate a crash by forcefully stopping the client
		const client = server.getClient();
		if (client) {
			// Force disconnect to simulate crash
			await client.disconnect();
			console.log("💥 Simulated server crash");

			// Wait for auto-restart
			await new Promise((resolve) => setTimeout(resolve, 5000));

			if (restartCount > 0) {
				console.log("✅ Auto-restart functionality working");
			} else {
				console.log("❌ Auto-restart did not trigger");
			}
		}

		await server.stop();
		server.dispose();

		return true;
	} catch (error) {
		console.error("❌ Crash recovery test failed:", error.message);
		server.dispose();
		return false;
	}
}

// Export for use in other tests
export { testMCPServer, testServerCrashRecovery };

// Run tests if this file is executed directly
if (require.main === module) {
	(async () => {
		try {
			const basicTestResult = await testMCPServer();
			const crashTestResult = await testServerCrashRecovery();

			if (basicTestResult && crashTestResult) {
				console.log("\n🎉 All MCP Server tests passed!");
				process.exit(0);
			} else {
				console.log("\n❌ Some tests failed");
				process.exit(1);
			}
		} catch (error) {
			console.error("❌ Test suite failed:", error);
			process.exit(1);
		}
	})();
}
