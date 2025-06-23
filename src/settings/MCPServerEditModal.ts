import {
	App,
	Modal,
	Setting,
	Notice,
	TextComponent,
	DropdownComponent,
	ToggleComponent,
	ButtonComponent,
	TextAreaComponent,
} from "obsidian";
import HydratePlugin from "../main";
import {
	MCPServerConfig,
	DEFAULT_MCP_SERVER_CONFIG,
	MCPServerConfigValidator,
} from "../mcp/MCPServerConfig";

export class MCPServersConfigModal extends Modal {
	private onSave: (configs: MCPServerConfig[]) => void;
	private jsonTextArea: TextAreaComponent;
	private currentJson: string;

	constructor(
		app: App,
		currentConfigs: MCPServerConfig[],
		onSave: (configs: MCPServerConfig[]) => void
	) {
		super(app);
		this.onSave = onSave;
		this.currentJson = this.configsToJson(currentConfigs);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "MCP Servers Configuration" });

		contentEl.createEl("p", {
			text: "Configure all your MCP servers using JSON format. This will replace your current server configuration.",
			cls: "setting-item-description",
		});

		// JSON Configuration
		new Setting(contentEl)
			.setName("MCP Servers JSON")
			.setDesc("Paste your complete MCP servers configuration")
			.addTextArea((text) => {
				this.jsonTextArea = text;
				text.inputEl.rows = 20;
				text.inputEl.style.width = "100%";
				text.inputEl.style.fontFamily = "monospace";
				text.inputEl.style.fontSize = "14px";

				text.setValue(this.currentJson).setPlaceholder(
					this.getExampleJson()
				);
			});

		// Example section
		const exampleEl = contentEl.createDiv({ cls: "mcp-config-example" });
		exampleEl.createEl("h3", { text: "Example Configuration:" });

		const exampleCode = exampleEl.createEl("pre");
		exampleCode.createEl("code", { text: this.getExampleJson() });

		// Info section
		const infoEl = contentEl.createDiv({ cls: "mcp-config-info" });
		infoEl.createEl("h4", { text: "Supported Formats:" });
		const infoList = infoEl.createEl("ul");
		infoList.createEl("li", {
			text: "STDIO servers: Use 'command' and 'args' fields",
		});
		infoList.createEl("li", { text: "SSE servers: Use 'url' field" });
		infoList.createEl("li", {
			text: "Environment variables: Use 'env' object",
		});
		infoList.createEl("li", {
			text: "Server names will be generated from the keys",
		});

		// Buttons
		const buttonContainer = contentEl.createDiv({
			cls: "modal-button-container",
		});

		const saveButton = buttonContainer.createEl("button", {
			text: "Save Configuration",
			cls: "mod-cta",
		});
		saveButton.onclick = () => {
			if (this.validateAndSave()) {
				this.close();
			}
		};

		const cancelButton = buttonContainer.createEl("button", {
			text: "Cancel",
		});
		cancelButton.onclick = () => this.close();
	}

	private configsToJson(configs: MCPServerConfig[]): string {
		const mcpServers: Record<string, any> = {};

		configs.forEach((config) => {
			const serverConfig: any = {};

			if (config.transport?.type === "sse" && config.transport.url) {
				serverConfig.url = config.transport.url;
			} else {
				serverConfig.command = config.command;
				if (config.args && config.args.length > 0) {
					serverConfig.args = config.args;
				}
			}

			if (config.env && Object.keys(config.env).length > 0) {
				serverConfig.env = config.env;
			}

			mcpServers[config.id] = serverConfig;
		});

		return JSON.stringify({ mcpServers }, null, 2);
	}

	private getExampleJson(): string {
		return JSON.stringify(
			{
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
					"tavily-mcp": {
						command: "npx",
						args: ["-y", "tavily-mcp@0.1.2"],
						env: {
							TAVILY_API_KEY: "your-api-key-here",
						},
					},
					"documentor-sse": {
						url: "http://localhost:3001/sse",
					},
				},
			},
			null,
			2
		);
	}

	private parseJsonToConfigs(jsonStr: string): MCPServerConfig[] {
		try {
			const parsed = JSON.parse(jsonStr);

			if (!parsed.mcpServers || typeof parsed.mcpServers !== "object") {
				throw new Error("JSON must contain 'mcpServers' object");
			}

			const configs: MCPServerConfig[] = [];

			Object.entries(parsed.mcpServers).forEach(
				([serverId, serverConfig]: [string, any]) => {
					const config: MCPServerConfig = {
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
					} else {
						throw new Error(
							`Server '${serverId}' must have either 'url' or 'command' field`
						);
					}

					// Set environment variables
					if (serverConfig.env) {
						config.env = serverConfig.env;
					}

					// Generate a better display name
					if (serverConfig.url) {
						try {
							config.name = new URL(serverConfig.url).hostname;
						} catch {
							config.name = serverId;
						}
					} else if (
						serverConfig.args &&
						serverConfig.args.length > 0
					) {
						const packageName = serverConfig.args[0];
						config.name =
							packageName
								.split("@")[0]
								.replace(/^@[^/]+\//, "") || serverId;
					} else {
						config.name = serverId;
					}

					configs.push(config);
				}
			);

			return configs;
		} catch (error) {
			throw new Error(`Invalid JSON configuration: ${error.message}`);
		}
	}

	private validateAndSave(): boolean {
		const jsonStr = this.jsonTextArea.getValue().trim();

		if (!jsonStr) {
			this.showError("Configuration cannot be empty");
			return false;
		}

		try {
			const configs = this.parseJsonToConfigs(jsonStr);

			if (configs.length === 0) {
				this.showError("No valid servers found in configuration");
				return false;
			}

			// Validate each server config
			for (const config of configs) {
				if (config.transport.type === "sse" && !config.transport.url) {
					this.showError(
						`Server '${config.id}': URL is required for SSE transport`
					);
					return false;
				}
				if (config.transport.type === "stdio" && !config.command) {
					this.showError(
						`Server '${config.id}': Command is required for STDIO transport`
					);
					return false;
				}
			}

			this.onSave(configs);
			new Notice(
				`Successfully configured ${configs.length} MCP server${
					configs.length === 1 ? "" : "s"
				}`
			);
			return true;
		} catch (error) {
			this.showError(error.message);
			return false;
		}
	}

	private showError(message: string) {
		// Remove existing error
		const existingError = this.contentEl.querySelector(".mcp-error");
		if (existingError) {
			existingError.remove();
		}

		// Add new error
		const errorEl = this.contentEl.createDiv({ cls: "mcp-error" });
		errorEl.style.color = "var(--text-error)";
		errorEl.style.marginTop = "10px";
		errorEl.style.padding = "8px";
		errorEl.style.background = "var(--background-modifier-error)";
		errorEl.style.borderRadius = "4px";
		errorEl.textContent = message;

		setTimeout(() => errorEl.remove(), 5000);
	}
}
