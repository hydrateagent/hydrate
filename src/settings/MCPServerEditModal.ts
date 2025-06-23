import {
	App,
	Modal,
	Setting,
	Notice,
	TextComponent,
	DropdownComponent,
	ToggleComponent,
	ButtonComponent,
} from "obsidian";
import HydratePlugin from "../main";
import {
	MCPServerConfig,
	DEFAULT_MCP_SERVER_CONFIG,
	MCPServerConfigValidator,
} from "../mcp/MCPServerConfig";

export class MCPServerEditModal extends Modal {
	plugin: HydratePlugin;
	config: Partial<MCPServerConfig>;
	isEditing: boolean;
	onSave: (config: MCPServerConfig) => void;

	// Form elements
	private idInput: TextComponent;
	private nameInput: TextComponent;
	private descriptionInput: TextComponent;
	private commandInput: TextComponent;
	private argsInput: TextComponent;
	private cwdInput: TextComponent;
	private envInput: TextComponent;
	private transportDropdown: DropdownComponent;
	private websocketUrlInput: TextComponent;
	private enabledToggle: ToggleComponent;
	private autoRestartToggle: ToggleComponent;
	private maxRestartsInput: TextComponent;
	private startupTimeoutInput: TextComponent;
	private shutdownTimeoutInput: TextComponent;
	private tagsInput: TextComponent;
	private versionInput: TextComponent;
	private healthIntervalInput: TextComponent;
	private healthTimeoutInput: TextComponent;
	private healthFailureThresholdInput: TextComponent;

	constructor(
		app: App,
		plugin: HydratePlugin,
		config: MCPServerConfig | null,
		onSave: (config: MCPServerConfig) => void
	) {
		super(app);
		this.plugin = plugin;
		this.config = config ? { ...config } : { ...DEFAULT_MCP_SERVER_CONFIG };
		this.isEditing = config !== null;
		this.onSave = onSave;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", {
			text: this.isEditing ? "Edit MCP Server" : "Add MCP Server",
		});

		// Basic Information Section
		contentEl.createEl("h3", { text: "Basic Information" });

		new Setting(contentEl)
			.setName("Server ID")
			.setDesc(
				"Unique identifier for this server (alphanumeric, hyphens, underscores only)"
			)
			.addText((text) => {
				this.idInput = text;
				text.setPlaceholder("my-mcp-server")
					.setValue(this.config.id || "")
					.setDisabled(this.isEditing) // Can't change ID when editing
					.onChange((value) => {
						this.config.id = value.trim();
					});
			});

		new Setting(contentEl)
			.setName("Server Name")
			.setDesc("Human-readable name for the server")
			.addText((text) => {
				this.nameInput = text;
				text.setPlaceholder("My MCP Server")
					.setValue(this.config.name || "")
					.onChange((value) => {
						this.config.name = value.trim();
					});
			});

		new Setting(contentEl)
			.setName("Description")
			.setDesc("Optional description of what this server provides")
			.addText((text) => {
				this.descriptionInput = text;
				text.setPlaceholder("Provides file system tools...")
					.setValue(this.config.description || "")
					.onChange((value) => {
						this.config.description = value.trim();
					});
			});

		// Command Configuration Section
		contentEl.createEl("h3", { text: "Command Configuration" });

		new Setting(contentEl)
			.setName("Command")
			.setDesc("Command to execute to start the server")
			.addText((text) => {
				this.commandInput = text;
				text.setPlaceholder("node")
					.setValue(this.config.command || "")
					.onChange((value) => {
						this.config.command = value.trim();
					});
			});

		new Setting(contentEl)
			.setName("Arguments")
			.setDesc("Command arguments (space-separated)")
			.addText((text) => {
				this.argsInput = text;
				text.setPlaceholder("server.js --port 3000")
					.setValue((this.config.args || []).join(" "))
					.onChange((value) => {
						this.config.args = value.trim()
							? value.trim().split(/\s+/)
							: [];
					});
			});

		new Setting(contentEl)
			.setName("Working Directory")
			.setDesc("Working directory for the server process (optional)")
			.addText((text) => {
				this.cwdInput = text;
				text.setPlaceholder("/path/to/server")
					.setValue(this.config.cwd || "")
					.onChange((value) => {
						this.config.cwd = value.trim() || undefined;
					});
			});

		new Setting(contentEl)
			.setName("Environment Variables")
			.setDesc("Environment variables as JSON object (optional)")
			.addText((text) => {
				this.envInput = text;
				text.setPlaceholder('{"NODE_ENV": "production"}')
					.setValue(
						this.config.env ? JSON.stringify(this.config.env) : ""
					)
					.onChange((value) => {
						try {
							this.config.env = value.trim()
								? JSON.parse(value)
								: {};
							text.inputEl.removeClass("hydrate-input-error");
						} catch (e) {
							text.inputEl.addClass("hydrate-input-error");
						}
					});
			});

		// Transport Configuration Section
		contentEl.createEl("h3", { text: "Transport Configuration" });

		new Setting(contentEl)
			.setName("Transport Type")
			.setDesc("Communication method with the server")
			.addDropdown((dropdown) => {
				this.transportDropdown = dropdown;
				dropdown
					.addOption("stdio", "Standard I/O")
					.addOption("websocket", "WebSocket")
					.setValue(this.config.transport || "stdio")
					.onChange((value: "stdio" | "websocket") => {
						this.config.transport = value;
						this.updateWebSocketVisibility();
					});
			});

		const websocketSetting = new Setting(contentEl)
			.setName("WebSocket URL")
			.setDesc(
				"URL for WebSocket connection (required for WebSocket transport)"
			)
			.addText((text) => {
				this.websocketUrlInput = text;
				text.setPlaceholder("ws://localhost:3001")
					.setValue(this.config.websocketUrl || "")
					.onChange((value) => {
						this.config.websocketUrl = value.trim() || undefined;
					});
			});

		// Server Settings Section
		contentEl.createEl("h3", { text: "Server Settings" });

		new Setting(contentEl)
			.setName("Enabled")
			.setDesc("Whether this server should be started automatically")
			.addToggle((toggle) => {
				this.enabledToggle = toggle;
				toggle
					.setValue(this.config.enabled !== false)
					.onChange((value) => {
						this.config.enabled = value;
					});
			});

		new Setting(contentEl)
			.setName("Auto Restart")
			.setDesc("Automatically restart the server if it crashes")
			.addToggle((toggle) => {
				this.autoRestartToggle = toggle;
				toggle
					.setValue(this.config.autoRestart !== false)
					.onChange((value) => {
						this.config.autoRestart = value;
					});
			});

		new Setting(contentEl)
			.setName("Max Restarts")
			.setDesc("Maximum number of restart attempts")
			.addText((text) => {
				this.maxRestartsInput = text;
				text.setPlaceholder("3")
					.setValue(String(this.config.maxRestarts || 3))
					.onChange((value) => {
						const num = parseInt(value);
						if (!isNaN(num) && num >= 0) {
							this.config.maxRestarts = num;
							text.inputEl.removeClass("hydrate-input-error");
						} else {
							text.inputEl.addClass("hydrate-input-error");
						}
					});
			});

		new Setting(contentEl)
			.setName("Startup Timeout (ms)")
			.setDesc("Timeout for server startup")
			.addText((text) => {
				this.startupTimeoutInput = text;
				text.setPlaceholder("10000")
					.setValue(String(this.config.startupTimeout || 10000))
					.onChange((value) => {
						const num = parseInt(value);
						if (!isNaN(num) && num > 0) {
							this.config.startupTimeout = num;
							text.inputEl.removeClass("hydrate-input-error");
						} else {
							text.inputEl.addClass("hydrate-input-error");
						}
					});
			});

		new Setting(contentEl)
			.setName("Shutdown Timeout (ms)")
			.setDesc("Timeout for server shutdown")
			.addText((text) => {
				this.shutdownTimeoutInput = text;
				text.setPlaceholder("5000")
					.setValue(String(this.config.shutdownTimeout || 5000))
					.onChange((value) => {
						const num = parseInt(value);
						if (!isNaN(num) && num > 0) {
							this.config.shutdownTimeout = num;
							text.inputEl.removeClass("hydrate-input-error");
						} else {
							text.inputEl.addClass("hydrate-input-error");
						}
					});
			});

		// Health Check Configuration Section
		contentEl.createEl("h3", { text: "Health Check Configuration" });

		new Setting(contentEl)
			.setName("Health Check Interval (ms)")
			.setDesc("Interval between health checks")
			.addText((text) => {
				this.healthIntervalInput = text;
				text.setPlaceholder("30000")
					.setValue(
						String(this.config.healthCheck?.interval || 30000)
					)
					.onChange((value) => {
						const num = parseInt(value);
						if (!isNaN(num) && num > 0) {
							if (!this.config.healthCheck) {
								this.config.healthCheck = {
									...DEFAULT_MCP_SERVER_CONFIG.healthCheck!,
								};
							}
							this.config.healthCheck.interval = num;
							text.inputEl.removeClass("hydrate-input-error");
						} else {
							text.inputEl.addClass("hydrate-input-error");
						}
					});
			});

		new Setting(contentEl)
			.setName("Health Check Timeout (ms)")
			.setDesc("Timeout for individual health check requests")
			.addText((text) => {
				this.healthTimeoutInput = text;
				text.setPlaceholder("5000")
					.setValue(String(this.config.healthCheck?.timeout || 5000))
					.onChange((value) => {
						const num = parseInt(value);
						if (!isNaN(num) && num > 0) {
							if (!this.config.healthCheck) {
								this.config.healthCheck = {
									...DEFAULT_MCP_SERVER_CONFIG.healthCheck!,
								};
							}
							this.config.healthCheck.timeout = num;
							text.inputEl.removeClass("hydrate-input-error");
						} else {
							text.inputEl.addClass("hydrate-input-error");
						}
					});
			});

		new Setting(contentEl)
			.setName("Failure Threshold")
			.setDesc("Number of failed checks before marking as unhealthy")
			.addText((text) => {
				this.healthFailureThresholdInput = text;
				text.setPlaceholder("3")
					.setValue(
						String(this.config.healthCheck?.failureThreshold || 3)
					)
					.onChange((value) => {
						const num = parseInt(value);
						if (!isNaN(num) && num > 0) {
							if (!this.config.healthCheck) {
								this.config.healthCheck = {
									...DEFAULT_MCP_SERVER_CONFIG.healthCheck!,
								};
							}
							this.config.healthCheck.failureThreshold = num;
							text.inputEl.removeClass("hydrate-input-error");
						} else {
							text.inputEl.addClass("hydrate-input-error");
						}
					});
			});

		// Optional Metadata Section
		contentEl.createEl("h3", { text: "Optional Metadata" });

		new Setting(contentEl)
			.setName("Tags")
			.setDesc("Comma-separated tags for categorizing this server")
			.addText((text) => {
				this.tagsInput = text;
				text.setPlaceholder("filesystem, development, tools")
					.setValue((this.config.tags || []).join(", "))
					.onChange((value) => {
						this.config.tags = value.trim()
							? value
									.split(",")
									.map((tag) => tag.trim())
									.filter((tag) => tag.length > 0)
							: undefined;
					});
			});

		new Setting(contentEl)
			.setName("Version")
			.setDesc("Version of the server (for updates/compatibility)")
			.addText((text) => {
				this.versionInput = text;
				text.setPlaceholder("1.0.0")
					.setValue(this.config.version || "")
					.onChange((value) => {
						this.config.version = value.trim() || undefined;
					});
			});

		// Action Buttons
		const buttonContainer = contentEl.createDiv("hydrate-modal-buttons");

		const testButton = buttonContainer.createEl("button", {
			text: "Test Connection",
			cls: "mod-warning",
		});
		testButton.addEventListener("click", () => this.testConnection());

		const saveButton = buttonContainer.createEl("button", {
			text: this.isEditing ? "Update Server" : "Add Server",
			cls: "mod-cta",
		});
		saveButton.addEventListener("click", () => this.save());

		const cancelButton = buttonContainer.createEl("button", {
			text: "Cancel",
		});
		cancelButton.addEventListener("click", () => this.close());

		// Initial WebSocket visibility update
		this.updateWebSocketVisibility();

		// Focus the name input
		setTimeout(() => {
			if (!this.isEditing) {
				this.idInput.inputEl.focus();
			} else {
				this.nameInput.inputEl.focus();
			}
		}, 100);
	}

	private updateWebSocketVisibility() {
		const websocketSettings =
			this.contentEl.querySelectorAll(".setting-item");
		const websocketUrlSetting = Array.from(websocketSettings).find(
			(setting) => setting.textContent?.includes("WebSocket URL")
		) as HTMLElement;

		if (websocketUrlSetting) {
			websocketUrlSetting.style.display =
				this.config.transport === "websocket" ? "flex" : "none";
		}
	}

	private async testConnection() {
		const errors = MCPServerConfigValidator.validate(this.config);
		if (errors.length > 0) {
			new Notice(`Configuration errors: ${errors.join(", ")}`);
			return;
		}

		const completeConfig = MCPServerConfigValidator.withDefaults(
			this.config
		);

		try {
			new Notice("Testing server connection...");

			// Test the connection using MCPServerManager
			if (this.plugin.mcpManager) {
				const testResult =
					await this.plugin.mcpManager.testServerConnection(
						completeConfig
					);
				if (testResult.success) {
					new Notice(
						`✅ Connection successful! Found ${
							testResult.toolCount || 0
						} tools.`
					);
				} else {
					new Notice(`❌ Connection failed: ${testResult.error}`);
				}
			} else {
				new Notice("❌ MCP Manager not available");
			}
		} catch (error) {
			console.error("Error testing MCP server connection:", error);
			new Notice(
				`❌ Test failed: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
		}
	}

	private save() {
		// Validate configuration
		const errors = MCPServerConfigValidator.validate(this.config);
		if (errors.length > 0) {
			new Notice(`Configuration errors: ${errors.join(", ")}`);
			return;
		}

		// Check for duplicate IDs (only when adding new)
		if (!this.isEditing) {
			const existingServers = this.plugin.settings.mcpServers || [];
			if (
				existingServers.some((server) => server.id === this.config.id)
			) {
				new Notice(
					"A server with this ID already exists. Please choose a different ID."
				);
				return;
			}
		}

		// Create complete configuration with defaults
		const completeConfig = MCPServerConfigValidator.withDefaults(
			this.config
		);

		// Call the save callback
		this.onSave(completeConfig);

		// Close the modal
		this.close();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
