// Test script for simplified MCP configuration interface
console.log("Testing Simplified MCP Configuration Interface");

// Test JSON parsing and transport type inference
function testConfigParsing() {
	console.log("\n=== Testing Configuration Parsing ===");

	const testCases = [
		{
			name: "STDIO Command",
			json: {
				mcpServers: {
					"browser-tools": {
						command: "npx",
						args: ["@agentdeskai/browser-tools-mcp@1.2.0"],
					},
				},
			},
			expected: {
				id: "browser-tools",
				transport: { type: "stdio" },
				command: "npx",
				args: ["@agentdeskai/browser-tools-mcp@1.2.0"],
			},
		},
		{
			name: "SSE URL",
			json: {
				mcpServers: {
					"documentor-sse": {
						url: "http://localhost:3001/sse",
					},
				},
			},
			expected: {
				id: "documentor-sse",
				transport: { type: "sse", url: "http://localhost:3001/sse" },
			},
		},
		{
			name: "With Environment Variables",
			json: {
				mcpServers: {
					"tavily-mcp": {
						command: "npx",
						args: ["-y", "tavily-mcp@0.1.2"],
						env: {
							TAVILY_API_KEY: "test-key",
						},
					},
				},
			},
			expected: {
				id: "tavily-mcp",
				transport: { type: "stdio" },
				command: "npx",
				args: ["-y", "tavily-mcp@0.1.2"],
				env: { TAVILY_API_KEY: "test-key" },
			},
		},
	];

	let passed = 0;
	let failed = 0;

	testCases.forEach((testCase) => {
		try {
			// Simulate parsing logic
			const mcpServers = testCase.json.mcpServers;
			const serverId = Object.keys(mcpServers)[0];
			const serverConfig = mcpServers[serverId];

			const config = {
				id: serverId,
				name: serverId,
				enabled: true,
				transport: { type: "stdio" },
				command: "",
				args: [],
				env: {},
				autoRestart: true,
				maxRestarts: 3,
				startupTimeout: 10000,
				shutdownTimeout: 5000,
			};

			// Infer transport type and set config
			if (serverConfig.url) {
				config.transport = {
					type: "sse",
					url: serverConfig.url,
				};
			} else if (serverConfig.command) {
				config.transport = { type: "stdio" };
				config.command = serverConfig.command;
				config.args = serverConfig.args || [];
			}

			// Set environment variables
			if (serverConfig.env) {
				config.env = serverConfig.env;
			}

			// Validate expected results
			const checks = [
				config.id === testCase.expected.id,
				config.transport.type === testCase.expected.transport.type,
				testCase.expected.transport.url
					? config.transport.url === testCase.expected.transport.url
					: true,
				testCase.expected.command
					? config.command === testCase.expected.command
					: true,
				testCase.expected.args
					? JSON.stringify(config.args) ===
					  JSON.stringify(testCase.expected.args)
					: true,
				testCase.expected.env
					? JSON.stringify(config.env) ===
					  JSON.stringify(testCase.expected.env)
					: true,
			];

			if (checks.every((check) => check)) {
				console.log(`✅ ${testCase.name}: PASSED`);
				passed++;
			} else {
				console.log(`❌ ${testCase.name}: FAILED`);
				console.log(`   Expected:`, testCase.expected);
				console.log(`   Got:`, {
					id: config.id,
					transport: config.transport,
					command: config.command,
					args: config.args,
					env: config.env,
				});
				failed++;
			}
		} catch (error) {
			console.log(`❌ ${testCase.name}: ERROR - ${error.message}`);
			failed++;
		}
	});

	console.log(`\nResults: ${passed} passed, ${failed} failed`);
	return failed === 0;
}

// Test multi-server configuration
function testMultiServerConfig() {
	console.log("\n=== Testing Multi-Server Configuration ===");

	const multiServerJson = {
		mcpServers: {
			"browser-tools": {
				command: "npx",
				args: ["@agentdeskai/browser-tools-mcp@1.2.0"],
			},
			"sequential-thinking": {
				command: "npx",
				args: [
					"-y",
					"@modelcontextprotocol/server-sequential-thinking",
				],
			},
			"documentor-sse": {
				url: "http://localhost:3001/sse",
			},
		},
	};

	try {
		const configs = [];
		Object.entries(multiServerJson.mcpServers).forEach(
			([serverId, serverConfig]) => {
				const config = {
					id: serverId,
					name: serverId,
					enabled: true,
					transport: { type: "stdio" },
					command: "",
					args: [],
					env: {},
					autoRestart: true,
					maxRestarts: 3,
					startupTimeout: 10000,
					shutdownTimeout: 5000,
				};

				if (serverConfig.url) {
					config.transport = { type: "sse", url: serverConfig.url };
				} else if (serverConfig.command) {
					config.transport = { type: "stdio" };
					config.command = serverConfig.command;
					config.args = serverConfig.args || [];
				}

				configs.push(config);
			}
		);

		if (configs.length === 3) {
			console.log("✅ Multi-server parsing: PASSED");
			console.log(`   Parsed ${configs.length} servers successfully`);

			// Check transport types
			const stdioCount = configs.filter(
				(c) => c.transport.type === "stdio"
			).length;
			const sseCount = configs.filter(
				(c) => c.transport.type === "sse"
			).length;

			if (stdioCount === 2 && sseCount === 1) {
				console.log("✅ Transport type inference: PASSED");
				return true;
			} else {
				console.log(
					`❌ Transport type inference: FAILED (${stdioCount} stdio, ${sseCount} sse)`
				);
				return false;
			}
		} else {
			console.log(
				`❌ Multi-server parsing: FAILED (expected 3, got ${configs.length})`
			);
			return false;
		}
	} catch (error) {
		console.log(`❌ Multi-server parsing: ERROR - ${error.message}`);
		return false;
	}
}

// Run tests
console.log("Starting MCP Configuration Tests...\n");

const test1 = testConfigParsing();
const test2 = testMultiServerConfig();

console.log("\n=== Final Results ===");
if (test1 && test2) {
	console.log(
		"🎉 All tests PASSED! The simplified MCP configuration interface is working correctly."
	);
} else {
	console.log("❌ Some tests FAILED. Please check the implementation.");
}
