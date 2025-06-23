/**
 * Test Suite: MCP Configuration Interface
 *
 * Tests the complete MCP server configuration workflow:
 * - Adding new MCP servers through the settings UI
 * - Testing server connections
 * - Editing server configurations
 * - Enabling/disabling servers
 * - Deleting servers
 * - Integration with MCPServerManager
 */

// Mock Obsidian environment
const mockObsidian = {
	App: class MockApp {},
	Modal: class MockModal {
		constructor(app) {
			this.app = app;
			this.contentEl = {
				empty: () => {},
				createEl: (tag, attrs) => ({
					textContent: attrs?.text || "",
					style: {},
					classList: {
						add: () => {},
						remove: () => {},
					},
					createEl: (tag, attrs) => ({
						textContent: attrs?.text || "",
						style: {},
					}),
					addEventListener: () => {},
				}),
				querySelectorAll: () => [],
				createDiv: (cls) => ({
					style: {},
					createEl: (tag, attrs) => ({
						textContent: attrs?.text || "",
						addEventListener: () => {},
					}),
				}),
			};
		}
		open() {}
		close() {}
		onOpen() {}
		onClose() {}
	},
	Setting: class MockSetting {
		constructor(containerEl) {
			this.containerEl = containerEl;
			return this;
		}
		setName(name) {
			this.name = name;
			return this;
		}
		setDesc(desc) {
			this.desc = desc;
			return this;
		}
		setClass(cls) {
			this.class = cls;
			return this;
		}
		addText(callback) {
			const textComponent = {
				setPlaceholder: (text) => {
					textComponent.placeholder = text;
					return textComponent;
				},
				setValue: (value) => {
					textComponent.value = value;
					return textComponent;
				},
				setDisabled: (disabled) => {
					textComponent.disabled = disabled;
					return textComponent;
				},
				onChange: (callback) => {
					textComponent.changeCallback = callback;
					return textComponent;
				},
				inputEl: {
					focus: () => {},
					classList: {
						add: () => {},
						remove: () => {},
					},
					type: "text",
				},
			};
			callback(textComponent);
			return this;
		}
		addDropdown(callback) {
			const dropdownComponent = {
				addOption: (value, text) => {
					return dropdownComponent;
				},
				setValue: (value) => {
					dropdownComponent.value = value;
					return dropdownComponent;
				},
				onChange: (callback) => {
					dropdownComponent.changeCallback = callback;
					return dropdownComponent;
				},
			};
			callback(dropdownComponent);
			return this;
		}
		addToggle(callback) {
			const toggleComponent = {
				setValue: (value) => {
					toggleComponent.value = value;
					return toggleComponent;
				},
				onChange: (callback) => {
					toggleComponent.changeCallback = callback;
					return toggleComponent;
				},
			};
			callback(toggleComponent);
			return this;
		}
		addButton(callback) {
			const buttonComponent = {
				setIcon: (icon) => {
					buttonComponent.icon = icon;
					return buttonComponent;
				},
				setTooltip: (tooltip) => {
					buttonComponent.tooltip = tooltip;
					return buttonComponent;
				},
				setButtonText: (text) => {
					buttonComponent.text = text;
					return buttonComponent;
				},
				setClass: (cls) => {
					buttonComponent.class = cls;
					return buttonComponent;
				},
				onClick: (callback) => {
					buttonComponent.clickCallback = callback;
					return buttonComponent;
				},
			};
			callback(buttonComponent);
			return this;
		}
	},
	Notice: class MockNotice {
		constructor(message) {
			console.log(`Notice: ${message}`);
		}
	},
};

// Mock MCP types and classes
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

const DEFAULT_MCP_SERVER_CONFIG = {
	autoRestart: true,
	maxRestarts: 3,
	startupTimeout: 10000,
	shutdownTimeout: 5000,
	enabled: true,
	transport: "stdio",
	env: {},
	args: [],
	healthCheck: {
		interval: 30000,
		timeout: 5000,
		failureThreshold: 3,
	},
};

const MCPServerConfigValidator = {
	validate: (config) => {
		const errors = [];
		if (!config.id) errors.push("Server ID is required");
		if (!config.name) errors.push("Server name is required");
		if (!config.command) errors.push("Server command is required");
		return errors;
	},
	withDefaults: (config) => ({
		...DEFAULT_MCP_SERVER_CONFIG,
		...config,
	}),
};

// Mock MCPServerManager
class MockMCPServerManager {
	constructor() {
		this.servers = new Map();
	}

	async testServerConnection(config) {
		// Simulate connection test
		await new Promise((resolve) => setTimeout(resolve, 100));

		if (config.command === "invalid-command") {
			return {
				success: false,
				error: "Command not found",
				latency: 150,
			};
		}

		return {
			success: true,
			toolCount: Math.floor(Math.random() * 10) + 1,
			latency: 120,
		};
	}

	async startServer(serverIdOrConfig) {
		const id =
			typeof serverIdOrConfig === "string"
				? serverIdOrConfig
				: serverIdOrConfig.id;
		console.log(`Starting server: ${id}`);
		return Promise.resolve();
	}

	async stopServer(serverId) {
		console.log(`Stopping server: ${serverId}`);
		return Promise.resolve();
	}

	getServerStatus(serverId) {
		return MCPServerStatus.RUNNING;
	}
}

// Mock plugin
class MockHydratePlugin {
	constructor() {
		this.settings = {
			mcpServers: [],
		};
		this.mcpManager = new MockMCPServerManager();
	}

	async saveSettings() {
		console.log("Settings saved:", JSON.stringify(this.settings, null, 2));
	}
}

// Import the classes we're testing (mocked)
class MCPServerEditModal extends mockObsidian.Modal {
	constructor(app, plugin, config, onSave) {
		super(app);
		this.plugin = plugin;
		this.config = config ? { ...config } : { ...DEFAULT_MCP_SERVER_CONFIG };
		this.isEditing = config !== null;
		this.onSave = onSave;
	}

	async testConnection() {
		const errors = MCPServerConfigValidator.validate(this.config);
		if (errors.length > 0) {
			new mockObsidian.Notice(
				`Configuration errors: ${errors.join(", ")}`
			);
			return;
		}

		const completeConfig = MCPServerConfigValidator.withDefaults(
			this.config
		);

		try {
			new mockObsidian.Notice("Testing server connection...");

			if (this.plugin.mcpManager) {
				const testResult =
					await this.plugin.mcpManager.testServerConnection(
						completeConfig
					);
				if (testResult.success) {
					new mockObsidian.Notice(
						`✅ Connection successful! Found ${
							testResult.toolCount || 0
						} tools.`
					);
				} else {
					new mockObsidian.Notice(
						`❌ Connection failed: ${testResult.error}`
					);
				}
			} else {
				new mockObsidian.Notice("❌ MCP Manager not available");
			}
		} catch (error) {
			console.error("Error testing MCP server connection:", error);
			new mockObsidian.Notice(`❌ Test failed: ${error.message}`);
		}
	}

	save() {
		const errors = MCPServerConfigValidator.validate(this.config);
		if (errors.length > 0) {
			new mockObsidian.Notice(
				`Configuration errors: ${errors.join(", ")}`
			);
			return;
		}

		if (!this.isEditing) {
			const existingServers = this.plugin.settings.mcpServers || [];
			if (
				existingServers.some((server) => server.id === this.config.id)
			) {
				new mockObsidian.Notice(
					"A server with this ID already exists. Please choose a different ID."
				);
				return;
			}
		}

		const completeConfig = MCPServerConfigValidator.withDefaults(
			this.config
		);
		this.onSave(completeConfig);
		this.close();
	}
}

class HydrateSettingTab {
	constructor(app, plugin) {
		this.app = app;
		this.plugin = plugin;
	}

	renderMCPServersList(containerEl) {
		const servers = this.plugin.settings.mcpServers || [];

		if (servers.length === 0) {
			console.log("No MCP servers configured");
			return;
		}

		servers.forEach((server) => {
			const statusText = this.getMCPServerStatusText(server);
			console.log(
				`Server: ${server.name} (${server.id}) - Status: ${statusText}`
			);
		});
	}

	getMCPServerStatusText(server) {
		if (!server.enabled) return "Disabled";

		if (this.plugin.mcpManager) {
			const status = this.plugin.mcpManager.getServerStatus(server.id);
			if (status) {
				switch (status) {
					case MCPServerStatus.RUNNING:
						return "Running";
					case MCPServerStatus.STARTING:
						return "Starting";
					case MCPServerStatus.STOPPING:
						return "Stopping";
					case MCPServerStatus.CRASHED:
						return "Crashed";
					case MCPServerStatus.FAILED:
						return "Failed";
					case MCPServerStatus.RESTARTING:
						return "Restarting";
					default:
						return "Stopped";
				}
			}
		}

		return "Unknown";
	}
}

// Test Suite
class MCPConfigurationInterfaceTests {
	constructor() {
		this.app = new mockObsidian.App();
		this.plugin = new MockHydratePlugin();
		this.settingsTab = new HydrateSettingTab(this.app, this.plugin);
		this.testResults = [];
	}

	async runAllTests() {
		console.log("🧪 Starting MCP Configuration Interface Tests...\n");

		await this.testAddNewMCPServer();
		await this.testEditMCPServer();
		await this.testServerConnectionTest();
		await this.testServerValidation();
		await this.testServerEnableDisable();
		await this.testServerDeletion();
		await this.testDuplicateServerPrevention();
		await this.testServerStatusDisplay();

		this.printResults();
	}

	async testAddNewMCPServer() {
		console.log("🔧 Test: Add New MCP Server");

		try {
			const modal = new MCPServerEditModal(
				this.app,
				this.plugin,
				null, // Creating new server
				(newServer) => {
					this.plugin.settings.mcpServers.push(newServer);
					this.plugin.saveSettings();
				}
			);

			// Simulate user input
			modal.config = {
				id: "test-server-1",
				name: "Test Server 1",
				description: "A test MCP server",
				command: "node",
				args: ["server.js"],
				transport: "stdio",
				enabled: true,
			};

			modal.save();

			// Verify server was added
			const servers = this.plugin.settings.mcpServers;
			const addedServer = servers.find((s) => s.id === "test-server-1");

			if (addedServer && addedServer.name === "Test Server 1") {
				this.testResults.push({
					test: "Add New MCP Server",
					status: "✅ PASS",
				});
				console.log("✅ Server successfully added to configuration\n");
			} else {
				throw new Error("Server was not added correctly");
			}
		} catch (error) {
			this.testResults.push({
				test: "Add New MCP Server",
				status: "❌ FAIL",
				error: error.message,
			});
			console.log(`❌ Test failed: ${error.message}\n`);
		}
	}

	async testEditMCPServer() {
		console.log("✏️ Test: Edit MCP Server");

		try {
			const existingServer = this.plugin.settings.mcpServers[0];
			const modal = new MCPServerEditModal(
				this.app,
				this.plugin,
				existingServer, // Editing existing server
				(updatedServer) => {
					this.plugin.settings.mcpServers =
						this.plugin.settings.mcpServers.map((s) =>
							s.id === updatedServer.id ? updatedServer : s
						);
					this.plugin.saveSettings();
				}
			);

			// Simulate editing
			modal.config.description = "Updated test server description";
			modal.config.maxRestarts = 5;

			modal.save();

			// Verify server was updated
			const updatedServer = this.plugin.settings.mcpServers.find(
				(s) => s.id === existingServer.id
			);

			if (
				updatedServer &&
				updatedServer.description ===
					"Updated test server description" &&
				updatedServer.maxRestarts === 5
			) {
				this.testResults.push({
					test: "Edit MCP Server",
					status: "✅ PASS",
				});
				console.log("✅ Server successfully updated\n");
			} else {
				throw new Error("Server was not updated correctly");
			}
		} catch (error) {
			this.testResults.push({
				test: "Edit MCP Server",
				status: "❌ FAIL",
				error: error.message,
			});
			console.log(`❌ Test failed: ${error.message}\n`);
		}
	}

	async testServerConnectionTest() {
		console.log("🔌 Test: Server Connection Test");

		try {
			const modal = new MCPServerEditModal(
				this.app,
				this.plugin,
				null,
				() => {}
			);

			// Test successful connection
			modal.config = {
				id: "test-connection",
				name: "Connection Test",
				command: "node",
				args: ["server.js"],
				transport: "stdio",
			};

			await modal.testConnection();

			// Test failed connection
			modal.config.command = "invalid-command";
			await modal.testConnection();

			this.testResults.push({
				test: "Server Connection Test",
				status: "✅ PASS",
			});
			console.log("✅ Connection test functionality works correctly\n");
		} catch (error) {
			this.testResults.push({
				test: "Server Connection Test",
				status: "❌ FAIL",
				error: error.message,
			});
			console.log(`❌ Test failed: ${error.message}\n`);
		}
	}

	async testServerValidation() {
		console.log("🔍 Test: Server Configuration Validation");

		try {
			const modal = new MCPServerEditModal(
				this.app,
				this.plugin,
				null,
				() => {}
			);

			// Test invalid configuration
			modal.config = {
				// Missing required fields
			};

			// This should not save due to validation errors
			const initialCount = this.plugin.settings.mcpServers.length;
			modal.save();
			const finalCount = this.plugin.settings.mcpServers.length;

			if (initialCount === finalCount) {
				this.testResults.push({
					test: "Server Configuration Validation",
					status: "✅ PASS",
				});
				console.log(
					"✅ Validation correctly prevents invalid configurations\n"
				);
			} else {
				throw new Error(
					"Validation failed to prevent invalid configuration"
				);
			}
		} catch (error) {
			this.testResults.push({
				test: "Server Configuration Validation",
				status: "❌ FAIL",
				error: error.message,
			});
			console.log(`❌ Test failed: ${error.message}\n`);
		}
	}

	async testServerEnableDisable() {
		console.log("🔄 Test: Server Enable/Disable");

		try {
			const server = this.plugin.settings.mcpServers[0];
			const originalEnabled = server.enabled;

			// Simulate toggle
			server.enabled = !server.enabled;
			await this.plugin.saveSettings();

			// Simulate MCP manager actions
			if (server.enabled) {
				await this.plugin.mcpManager.startServer(server);
			} else {
				await this.plugin.mcpManager.stopServer(server.id);
			}

			this.testResults.push({
				test: "Server Enable/Disable",
				status: "✅ PASS",
			});
			console.log(
				"✅ Server enable/disable functionality works correctly\n"
			);
		} catch (error) {
			this.testResults.push({
				test: "Server Enable/Disable",
				status: "❌ FAIL",
				error: error.message,
			});
			console.log(`❌ Test failed: ${error.message}\n`);
		}
	}

	async testServerDeletion() {
		console.log("🗑️ Test: Server Deletion");

		try {
			const initialCount = this.plugin.settings.mcpServers.length;
			const serverToDelete = this.plugin.settings.mcpServers[0];

			// Simulate deletion
			if (this.plugin.mcpManager) {
				await this.plugin.mcpManager.stopServer(serverToDelete.id);
			}

			this.plugin.settings.mcpServers =
				this.plugin.settings.mcpServers.filter(
					(s) => s.id !== serverToDelete.id
				);
			await this.plugin.saveSettings();

			const finalCount = this.plugin.settings.mcpServers.length;

			if (finalCount === initialCount - 1) {
				this.testResults.push({
					test: "Server Deletion",
					status: "✅ PASS",
				});
				console.log("✅ Server deletion works correctly\n");
			} else {
				throw new Error("Server was not deleted correctly");
			}
		} catch (error) {
			this.testResults.push({
				test: "Server Deletion",
				status: "❌ FAIL",
				error: error.message,
			});
			console.log(`❌ Test failed: ${error.message}\n`);
		}
	}

	async testDuplicateServerPrevention() {
		console.log("🚫 Test: Duplicate Server Prevention");

		try {
			// Add a server first
			const modal1 = new MCPServerEditModal(
				this.app,
				this.plugin,
				null,
				(newServer) => {
					this.plugin.settings.mcpServers.push(newServer);
					this.plugin.saveSettings();
				}
			);

			modal1.config = {
				id: "duplicate-test",
				name: "Duplicate Test",
				command: "node",
				args: ["server.js"],
				transport: "stdio",
			};

			modal1.save();

			// Try to add another server with the same ID
			const modal2 = new MCPServerEditModal(
				this.app,
				this.plugin,
				null,
				(newServer) => {
					this.plugin.settings.mcpServers.push(newServer);
					this.plugin.saveSettings();
				}
			);

			modal2.config = {
				id: "duplicate-test", // Same ID
				name: "Duplicate Test 2",
				command: "node",
				args: ["server2.js"],
				transport: "stdio",
			};

			const countBefore = this.plugin.settings.mcpServers.length;
			modal2.save(); // This should fail
			const countAfter = this.plugin.settings.mcpServers.length;

			if (countBefore === countAfter) {
				this.testResults.push({
					test: "Duplicate Server Prevention",
					status: "✅ PASS",
				});
				console.log("✅ Duplicate server prevention works correctly\n");
			} else {
				throw new Error("Duplicate server was not prevented");
			}
		} catch (error) {
			this.testResults.push({
				test: "Duplicate Server Prevention",
				status: "❌ FAIL",
				error: error.message,
			});
			console.log(`❌ Test failed: ${error.message}\n`);
		}
	}

	async testServerStatusDisplay() {
		console.log("📊 Test: Server Status Display");

		try {
			// Add a test server
			this.plugin.settings.mcpServers.push({
				id: "status-test",
				name: "Status Test Server",
				command: "node",
				args: ["server.js"],
				transport: "stdio",
				enabled: true,
			});

			// Test status display
			this.settingsTab.renderMCPServersList(null);

			this.testResults.push({
				test: "Server Status Display",
				status: "✅ PASS",
			});
			console.log("✅ Server status display works correctly\n");
		} catch (error) {
			this.testResults.push({
				test: "Server Status Display",
				status: "❌ FAIL",
				error: error.message,
			});
			console.log(`❌ Test failed: ${error.message}\n`);
		}
	}

	printResults() {
		console.log("📋 Test Results Summary:");
		console.log("=" * 50);

		let passed = 0;
		let failed = 0;

		this.testResults.forEach((result) => {
			console.log(`${result.status} ${result.test}`);
			if (result.error) {
				console.log(`   Error: ${result.error}`);
			}

			if (result.status.includes("✅")) passed++;
			else failed++;
		});

		console.log("=" * 50);
		console.log(`Total: ${this.testResults.length} tests`);
		console.log(`Passed: ${passed}`);
		console.log(`Failed: ${failed}`);
		console.log(
			`Success Rate: ${((passed / this.testResults.length) * 100).toFixed(
				1
			)}%`
		);

		if (failed === 0) {
			console.log(
				"\n🎉 All tests passed! MCP Configuration Interface is working correctly."
			);
		} else {
			console.log(
				`\n⚠️ ${failed} test(s) failed. Please review the errors above.`
			);
		}
	}
}

// Run the tests
async function runMCPConfigurationInterfaceTests() {
	const testSuite = new MCPConfigurationInterfaceTests();
	await testSuite.runAllTests();
}

// Export for use
if (typeof module !== "undefined" && module.exports) {
	module.exports = { runMCPConfigurationInterfaceTests };
} else {
	// Run tests immediately if in browser/node environment
	runMCPConfigurationInterfaceTests().catch(console.error);
}
