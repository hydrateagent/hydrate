import { createStdioMCPClient } from "./MCPClient";

/**
 * Test script to verify MCP client implementation
 * This tests the basic functionality against the @modelcontextprotocol/server-everything
 */
async function testMCPClient() {
	console.log("🧪 Testing MCP Client Implementation...");

	// Create a client connected to the test server
	const client = createStdioMCPClient("npx", [
		"@modelcontextprotocol/server-everything",
	]);

	try {
		// Test 1: Connection
		console.log("📡 Testing connection...");

		client.on("connect", () => {
			console.log("✅ Transport connected");
		});

		client.on("initialized", (result) => {
			console.log("✅ MCP session initialized:", result);
		});

		client.on("error", (error) => {
			console.error("❌ Client error:", error.message);
		});

		client.on("stderr", (data) => {
			console.log("📝 Server stderr:", data.trim());
		});

		await client.connect();
		console.log("✅ Connection test passed");

		// Test 2: List tools
		console.log("🔧 Testing tool discovery...");
		const tools = await client.listTools();
		console.log(`✅ Discovered ${tools.length} tools:`);
		tools.forEach((tool) => {
			console.log(`  - ${tool.name}: ${tool.description}`);
		});

		// Test 3: Call a tool (if available)
		if (tools.length > 0) {
			console.log("⚡ Testing tool execution...");
			const firstTool = tools[0];

			try {
				// Try to call the first tool with minimal parameters
				const result = await client.callTool(firstTool.name, {});
				console.log(`✅ Tool execution successful:`, result);
			} catch (error) {
				console.log(
					`⚠️ Tool execution failed (expected for some tools):`,
					error.message
				);
			}
		}

		// Test 4: Cleanup
		console.log("🧹 Testing disconnection...");
		await client.disconnect();
		console.log("✅ Disconnection test passed");

		console.log("🎉 All MCP client tests completed successfully!");
	} catch (error) {
		console.error("❌ Test failed:", error.message);
		throw error;
	}
}

// Export for potential use in other tests
export { testMCPClient };

// Run the test if this file is executed directly
if (require.main === module) {
	testMCPClient()
		.then(() => {
			console.log("✅ Test suite completed");
			process.exit(0);
		})
		.catch((error) => {
			console.error("❌ Test suite failed:", error);
			process.exit(1);
		});
}
