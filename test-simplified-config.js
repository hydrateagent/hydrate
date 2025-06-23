// Test script for simplified MCP configuration interface
console.log("Testing Simplified MCP Configuration Interface");

// Test JSON parsing and transport type inference
function testConfigParsing() {
	console.log("\n=== Testing Configuration Parsing ===");

	const testCases = [
		{
			name: "STDIO Command",
			json: {
				command: "npx",
				args: ["@agentdeskai/browser-tools-mcp@1.2.0"],
			},
			expected: {
				transport: { type: "stdio" },
				command: "npx",
				args: ["@agentdeskai/browser-tools-mcp@1.2.0"],
			},
		},
		{
			name: "SSE URL",
			json: {
				url: "http://localhost:3001/sse",
			},
			expected: {
				transport: { type: "sse", url: "http://localhost:3001/sse" },
				command: "",
				args: [],
			},
		},
		{
			name: "With Environment Variables",
			json: {
				command: "npx",
				args: ["-y", "tavily-mcp@0.1.2"],
				env: {
					TAVILY_API_KEY: "test-key",
				},
			},
			expected: {
				transport: { type: "stdio" },
				command: "npx",
				args: ["-y", "tavily-mcp@0.1.2"],
				env: { TAVILY_API_KEY: "test-key" },
			},
		},
	];

	let passed = 0;
	let total = testCases.length;

	testCases.forEach((testCase, index) => {
		try {
			// Simulate the parsing logic from MCPServerEditModal
			const config = {
				id: "",
				name: "",
				enabled: true,
				transport: { type: "stdio" },
				command: "",
				args: [],
				env: {},
				settings: {},
				metadata: {},
			};

			const parsed = testCase.json;

			// Infer transport type
			if (parsed.url) {
				config.transport = {
					type: "sse",
					url: parsed.url,
				};
				config.command = "";
				config.args = [];
			} else if (parsed.command) {
				config.transport = { type: "stdio" };
				config.command = parsed.command;
				config.args = parsed.args || [];
			}

			// Set environment variables
			config.env = parsed.env || {};

			// Generate name if not set
			if (!config.name) {
				if (parsed.url) {
					config.name = new URL(parsed.url).hostname;
				} else if (parsed.command) {
					config.name =
						parsed.args?.[0]?.split("@")[0] || parsed.command;
				}
			}

			// Validate results
			const isValid =
				config.transport.type === testCase.expected.transport.type &&
				config.command === testCase.expected.command &&
				JSON.stringify(config.args) ===
					JSON.stringify(testCase.expected.args) &&
				JSON.stringify(config.env) ===
					JSON.stringify(testCase.expected.env || {});

			if (isValid) {
				console.log(`✅ ${testCase.name}: PASSED`);
				passed++;
			} else {
				console.log(`❌ ${testCase.name}: FAILED`);
				console.log("Expected:", testCase.expected);
				console.log("Got:", {
					transport: config.transport,
					command: config.command,
					args: config.args,
					env: config.env,
				});
			}
		} catch (error) {
			console.log(`❌ ${testCase.name}: ERROR - ${error.message}`);
		}
	});

	console.log(`\nResults: ${passed}/${total} tests passed`);
	return passed === total;
}

// Test configuration validation
function testConfigValidation() {
	console.log("\n=== Testing Configuration Validation ===");

	const testCases = [
		{
			name: "Valid STDIO config",
			config: {
				id: "test-server",
				transport: { type: "stdio" },
				command: "npx",
				args: ["test-mcp"],
			},
			shouldPass: true,
		},
		{
			name: "Valid SSE config",
			config: {
				id: "sse-server",
				transport: { type: "sse", url: "http://localhost:3001/sse" },
			},
			shouldPass: true,
		},
		{
			name: "Missing ID",
			config: {
				id: "",
				transport: { type: "stdio" },
				command: "npx",
			},
			shouldPass: false,
		},
		{
			name: "STDIO missing command",
			config: {
				id: "test",
				transport: { type: "stdio" },
				command: "",
			},
			shouldPass: false,
		},
		{
			name: "SSE missing URL",
			config: {
				id: "test",
				transport: { type: "sse" },
			},
			shouldPass: false,
		},
		{
			name: "SSE invalid URL",
			config: {
				id: "test",
				transport: { type: "sse", url: "not-a-url" },
			},
			shouldPass: false,
		},
	];

	let passed = 0;
	let total = testCases.length;

	testCases.forEach((testCase) => {
		try {
			// Simulate validation logic
			let isValid = true;
			let errorMessage = "";

			if (!testCase.config.id?.trim()) {
				isValid = false;
				errorMessage = "Server ID is required";
			} else if (testCase.config.transport?.type === "sse") {
				if (!testCase.config.transport?.url) {
					isValid = false;
					errorMessage = "URL is required for SSE transport";
				} else {
					try {
						new URL(testCase.config.transport.url);
					} catch {
						isValid = false;
						errorMessage = "Invalid URL format";
					}
				}
			} else if (!testCase.config.command) {
				isValid = false;
				errorMessage = "Command is required for STDIO transport";
			}

			const testPassed = isValid === testCase.shouldPass;

			if (testPassed) {
				console.log(`✅ ${testCase.name}: PASSED`);
				passed++;
			} else {
				console.log(`❌ ${testCase.name}: FAILED`);
				console.log(
					`  Expected ${
						testCase.shouldPass ? "valid" : "invalid"
					}, got ${isValid ? "valid" : "invalid"}`
				);
				if (errorMessage) console.log(`  Error: ${errorMessage}`);
			}
		} catch (error) {
			console.log(`❌ ${testCase.name}: ERROR - ${error.message}`);
		}
	});

	console.log(`\nResults: ${passed}/${total} tests passed`);
	return passed === total;
}

// Run tests
function runAllTests() {
	console.log("🧪 Running Simplified MCP Configuration Tests");

	const results = [testConfigParsing(), testConfigValidation()];

	const allPassed = results.every((result) => result);
	console.log(
		`\n${allPassed ? "🎉 All tests passed!" : "❌ Some tests failed"}`
	);

	return allPassed;
}

// Run the tests
if (typeof module !== "undefined" && module.exports) {
	module.exports = { runAllTests, testConfigParsing, testConfigValidation };
} else {
	runAllTests();
}
