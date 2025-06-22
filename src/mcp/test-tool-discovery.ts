import { MCPServer } from "./MCPServer";
import {
	MCPToolDiscovery,
	MCPToolSchemaWithMetadata,
} from "./MCPToolDiscovery";
import { MCP_SERVER_TEMPLATES } from "./MCPServerConfig";

/**
 * Test script to verify MCP Tool Discovery functionality
 */
export async function testToolDiscovery() {
	console.log("🧪 Testing MCP Tool Discovery...");

	// Test 1: Discovery system creation and configuration
	console.log("🔧 Testing discovery system creation...");

	const discovery = new MCPToolDiscovery({
		cacheTtl: 60000, // 1 minute for testing
		discoveryInterval: 30000, // 30 seconds
		autoDiscovery: true,
		validateSchemas: true,
		discoveryTimeout: 15000, // 15 seconds
	});

	console.log("✅ Discovery system created successfully");

	// Test 2: Server setup
	console.log("🚀 Setting up test servers...");

	const server1Config = {
		id: "test-discovery-server-1",
		...MCP_SERVER_TEMPLATES["everything-server"],
	};

	const server2Config = {
		id: "test-discovery-server-2",
		name: "Test Server 2",
		command: "npx",
		args: ["@modelcontextprotocol/server-everything"],
		tags: ["test", "secondary"],
	};

	const server1 = new MCPServer(server1Config);
	const server2 = new MCPServer(server2Config);

	// Event tracking
	let toolsDiscoveredEvents = 0;
	let toolsAdded = 0;
	let toolsUpdated = 0;
	let toolsRemoved = 0;
	let discoveryErrors = 0;
	let cacheUpdates = 0;

	discovery.on("tools-discovered", (serverId, tools) => {
		toolsDiscoveredEvents++;
		console.log(
			`🔍 Tools discovered from ${serverId}: ${tools.length} tools`
		);
	});

	discovery.on("tool-added", (tool) => {
		toolsAdded++;
		console.log(`➕ Tool added: ${tool.name} from ${tool.serverId}`);
	});

	discovery.on("tool-updated", (tool, previous) => {
		toolsUpdated++;
		console.log(`🔄 Tool updated: ${tool.name} from ${tool.serverId}`);
	});

	discovery.on("tool-removed", (serverId, toolName) => {
		toolsRemoved++;
		console.log(`➖ Tool removed: ${toolName} from ${serverId}`);
	});

	discovery.on("discovery-error", (serverId, error) => {
		discoveryErrors++;
		console.log(`❌ Discovery error for ${serverId}: ${error.message}`);
	});

	discovery.on("cache-updated", (serverId, toolCount) => {
		cacheUpdates++;
		console.log(`💾 Cache updated for ${serverId}: ${toolCount} tools`);
	});

	try {
		// Test 3: Single server discovery
		console.log("\n1️⃣ Testing single server discovery...");

		await server1.start();
		console.log("✅ Server 1 started");

		const tools1 = await discovery.discoverTools(server1);
		console.log(`🔍 Discovered ${tools1.length} tools from server 1`);

		if (tools1.length === 0) {
			console.warn(
				"⚠️ No tools discovered - this might indicate an issue"
			);
		} else {
			console.log("✅ Tool discovery successful");

			// Validate tool metadata
			const firstTool = tools1[0];
			if (
				!firstTool.serverId ||
				!firstTool.serverName ||
				!firstTool.discoveredAt ||
				!firstTool.schemaHash
			) {
				throw new Error("Tool metadata is incomplete");
			}
			console.log("✅ Tool metadata validation passed");
		}

		// Test 4: Cache functionality
		console.log("\n2️⃣ Testing cache functionality...");

		const cachedTools1 = discovery.getToolsFromServer(server1Config.id);
		if (cachedTools1.length !== tools1.length) {
			throw new Error(
				`Cache mismatch: expected ${tools1.length}, got ${cachedTools1.length}`
			);
		}
		console.log("✅ Cache retrieval successful");

		// Test cache hit (should not trigger new discovery)
		const startTime = Date.now();
		const tools1Cached = await discovery.discoverTools(server1);
		const endTime = Date.now();

		if (endTime - startTime > 1000) {
			console.warn(
				"⚠️ Cache might not be working - discovery took too long"
			);
		} else {
			console.log("✅ Cache hit successful (fast retrieval)");
		}

		// Test 5: Multiple server discovery
		console.log("\n3️⃣ Testing multiple server discovery...");

		await server2.start();
		console.log("✅ Server 2 started");

		const multiServerResults = await discovery.discoverToolsFromServers([
			server1,
			server2,
		]);

		if (multiServerResults.size !== 2) {
			throw new Error(
				`Expected results from 2 servers, got ${multiServerResults.size}`
			);
		}

		const server1Tools = multiServerResults.get(server1Config.id) || [];
		const server2Tools = multiServerResults.get(server2Config.id) || [];

		console.log(
			`🔍 Multi-server discovery: Server 1: ${server1Tools.length}, Server 2: ${server2Tools.length} tools`
		);
		console.log("✅ Multiple server discovery successful");

		// Test 6: Tool search and filtering
		console.log("\n4️⃣ Testing tool search and filtering...");

		const allTools = discovery.getAllTools();
		console.log(`📊 Total tools cached: ${allTools.length}`);

		// Test search functionality
		if (allTools.length > 0) {
			const firstToolName = allTools[0].name;
			const searchResults = discovery.searchTools(firstToolName);

			if (searchResults.length === 0) {
				throw new Error("Search should have found at least one tool");
			}
			console.log(
				`🔍 Search for "${firstToolName}" found ${searchResults.length} results`
			);

			// Test category filtering
			const categories = new Set(allTools.map((t) => t.category));
			console.log(
				`📂 Tool categories found: ${Array.from(categories).join(", ")}`
			);

			if (categories.size > 0) {
				const firstCategory = Array.from(categories)[0];
				const categoryTools = discovery.getToolsByCategory(
					firstCategory!
				);
				console.log(
					`📂 Tools in "${firstCategory}" category: ${categoryTools.length}`
				);
			}
		}

		console.log("✅ Search and filtering tests passed");

		// Test 7: Specific tool retrieval
		console.log("\n5️⃣ Testing specific tool retrieval...");

		if (allTools.length > 0) {
			const testTool = allTools[0];
			const retrievedTool = discovery.getTool(
				testTool.serverId,
				testTool.name
			);

			if (!retrievedTool) {
				throw new Error("Should have retrieved the tool");
			}

			if (retrievedTool.name !== testTool.name) {
				throw new Error("Retrieved tool name mismatch");
			}

			console.log(
				`🎯 Successfully retrieved tool: ${retrievedTool.name}`
			);
		}

		console.log("✅ Specific tool retrieval test passed");

		// Test 8: Schema validation
		console.log("\n6️⃣ Testing schema validation...");

		// Test with validation enabled
		const validationDiscovery = new MCPToolDiscovery({
			validateSchemas: true,
			cacheTtl: 1000, // Short TTL for testing
		});

		const validatedTools = await validationDiscovery.discoverTools(server1);
		console.log(
			`✅ Schema validation: ${validatedTools.length} valid tools found`
		);

		// Test 9: Cache expiration and refresh
		console.log("\n7️⃣ Testing cache expiration and refresh...");

		// Force cache refresh
		const refreshedTools = await discovery.refreshTools(server1);
		console.log(`🔄 Cache refresh: ${refreshedTools.length} tools`);

		if (refreshedTools.length !== tools1.length) {
			console.warn(
				"⚠️ Refresh returned different number of tools than initial discovery"
			);
		} else {
			console.log("✅ Cache refresh successful");
		}

		// Test 10: Auto-discovery
		console.log("\n8️⃣ Testing auto-discovery...");

		discovery.startAutoDiscovery(server1);
		console.log("🔄 Auto-discovery started for server 1");

		// Wait a bit to see if auto-discovery triggers
		await new Promise((resolve) => setTimeout(resolve, 2000));

		discovery.stopAutoDiscovery(server1Config.id);
		console.log("⏹️ Auto-discovery stopped");

		// Test 11: Statistics and usage tracking
		console.log("\n9️⃣ Testing statistics and usage tracking...");

		const stats = discovery.getCacheStats();
		console.log("📊 Cache statistics:", {
			totalServers: stats.totalServers,
			totalTools: stats.totalTools,
			averageToolsPerServer: stats.averageToolsPerServer.toFixed(2),
		});

		// Test usage tracking
		if (allTools.length > 0) {
			const testTool = allTools[0];
			discovery.updateToolStats(
				testTool.serverId,
				testTool.name,
				1500, // 1.5 seconds
				true // successful
			);

			const updatedTool = discovery.getTool(
				testTool.serverId,
				testTool.name
			);
			if (
				updatedTool?.stats?.callCount !== 1 ||
				updatedTool?.stats?.successRate !== 1
			) {
				throw new Error("Usage statistics not updated correctly");
			}
			console.log("✅ Usage statistics tracking works");
		}

		// Test 12: Cache management
		console.log("\n🔟 Testing cache management...");

		const initialCacheStats = discovery.getCacheStats();
		console.log(`📊 Initial cache: ${initialCacheStats.totalTools} tools`);

		// Clear specific server cache
		discovery.clearServerCache(server1Config.id);
		const afterClearStats = discovery.getCacheStats();
		console.log(
			`📊 After clearing server 1: ${afterClearStats.totalTools} tools`
		);

		// Clear all cache
		discovery.clearAllCache();
		const afterClearAllStats = discovery.getCacheStats();
		if (afterClearAllStats.totalTools !== 0) {
			throw new Error("Cache should be empty after clearing all");
		}
		console.log("✅ Cache management works correctly");

		// Cleanup
		await server1.stop();
		await server2.stop();
		server1.dispose();
		server2.dispose();
		discovery.dispose();

		console.log("\n🎉 All tool discovery tests completed successfully!");

		// Summary
		console.log("\n📋 Test Summary:");
		console.log(`Tools discovered events: ${toolsDiscoveredEvents}`);
		console.log(`Tools added: ${toolsAdded}`);
		console.log(`Tools updated: ${toolsUpdated}`);
		console.log(`Tools removed: ${toolsRemoved}`);
		console.log(`Discovery errors: ${discoveryErrors}`);
		console.log(`Cache updates: ${cacheUpdates}`);

		return true;
	} catch (error) {
		console.error("❌ Test failed:", error.message);

		// Cleanup on error
		try {
			await server1.stop();
			await server2.stop();
			server1.dispose();
			server2.dispose();
			discovery.dispose();
		} catch (cleanupError) {
			console.warn("⚠️ Cleanup error:", cleanupError);
		}

		return false;
	}
}

/**
 * Test schema validation edge cases
 */
export async function testSchemaValidation() {
	console.log("\n🧪 Testing Schema Validation Edge Cases...");

	const discovery = new MCPToolDiscovery({
		validateSchemas: true,
		cacheTtl: 60000,
	});

	// Mock server for testing invalid schemas
	const mockServer = {
		getConfig: () => ({ id: "mock-server", name: "Mock Server" }),
		getClient: () => ({
			async listTools() {
				return [
					// Valid tool
					{
						name: "valid_tool",
						description: "A valid tool",
						inputSchema: {
							type: "object",
							properties: {
								param1: { type: "string" },
							},
						},
					},
					// Invalid tool - missing description
					{
						name: "invalid_tool_1",
						inputSchema: {
							type: "object",
							properties: {},
						},
					},
					// Invalid tool - missing inputSchema
					{
						name: "invalid_tool_2",
						description: "Missing input schema",
					},
					// Invalid tool - wrong inputSchema type
					{
						name: "invalid_tool_3",
						description: "Wrong schema type",
						inputSchema: {
							type: "string", // Should be object
						},
					},
				];
			},
		}),
	} as any;

	try {
		const tools = await discovery.discoverTools(mockServer);

		// Should only have the valid tool
		if (tools.length !== 1) {
			throw new Error(`Expected 1 valid tool, got ${tools.length} tools`);
		}

		if (tools[0].name !== "valid_tool") {
			throw new Error(`Expected valid_tool, got ${tools[0].name}`);
		}

		console.log("✅ Schema validation correctly filtered invalid tools");

		discovery.dispose();
		return true;
	} catch (error) {
		console.error("❌ Schema validation test failed:", error.message);
		discovery.dispose();
		return false;
	}
}

/**
 * Test discovery timeout handling
 */
export async function testDiscoveryTimeout() {
	console.log("\n🧪 Testing Discovery Timeout Handling...");

	const discovery = new MCPToolDiscovery({
		discoveryTimeout: 1000, // 1 second timeout
	});

	// Mock server that takes too long to respond
	const slowServer = {
		getConfig: () => ({ id: "slow-server", name: "Slow Server" }),
		getClient: () => ({
			async listTools() {
				// Simulate slow response
				await new Promise((resolve) => setTimeout(resolve, 2000));
				return [];
			},
		}),
	} as any;

	try {
		await discovery.discoverTools(slowServer);
		console.error("❌ Should have timed out");
		discovery.dispose();
		return false;
	} catch (error) {
		if (error.message.includes("timeout")) {
			console.log("✅ Discovery timeout handled correctly");
			discovery.dispose();
			return true;
		} else {
			console.error("❌ Unexpected error:", error.message);
			discovery.dispose();
			return false;
		}
	}
}

// Run tests if this file is executed directly
if (require.main === module) {
	(async () => {
		try {
			const test1 = await testToolDiscovery();
			const test2 = await testSchemaValidation();
			const test3 = await testDiscoveryTimeout();

			if (test1 && test2 && test3) {
				console.log("\n🎉 All tool discovery tests passed!");
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
