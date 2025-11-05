import {
	App,
	Modal,
	Notice,
	ButtonComponent,
	TextAreaComponent,
} from "obsidian";
import { MCPServerConfig } from "../mcp/MCPServerConfig";

export class MCPServersConfigModal extends Modal {
	private onSave: (configs: MCPServerConfig[]) => void;
	private jsonTextArea: TextAreaComponent;
	private currentJson: string;

	constructor(
		app: App,
		currentConfigs: MCPServerConfig[],
		onSave: (configs: MCPServerConfig[]) => void,
	) {
		super(app);
		this.onSave = onSave;
		this.currentJson = this.configsToJson(currentConfigs);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "Configure servers" });

		contentEl.createEl("p", {
			text: "Configure all your servers using JSON format. This will replace your current server configuration.",
			cls: "setting-item-description",
		});

		// JSON Configuration
		// Add a header and description above the textarea
		contentEl.createEl("h4", { text: "Configuration" });
		contentEl.createEl("p", {
			text: "Paste your complete servers configuration.",
		});
		const jsonTextAreaEl = contentEl.createEl("textarea");
		jsonTextAreaEl.rows = 20;
		jsonTextAreaEl.classList.add(
			"hydrate-mcp-textarea",
			"hydrate-full-width",
		);
		jsonTextAreaEl.value = this.currentJson;
		jsonTextAreaEl.placeholder = this.getExampleJson();
		this.jsonTextArea = {
			getValue: () => jsonTextAreaEl.value,
			setValue: (v: string) => {
				jsonTextAreaEl.value = v;
				return this.jsonTextArea;
			},
			inputEl: jsonTextAreaEl,
		} as unknown as TextAreaComponent;

		// Example section
		const exampleEl = contentEl.createDiv({
			cls: "hydrate-mcp-config-example",
		});
		exampleEl.createEl("h3", { text: "Example configuration:" });

		const exampleCode = exampleEl.createEl("pre");
		exampleCode.createEl("code", { text: this.getExampleJson() });

		// Info section
		const infoEl = contentEl.createDiv({ cls: "hydrate-mcp-config-info" });
		infoEl.createEl("h4", { text: "Formats:" });
		const infoList = infoEl.createEl("ul");
		infoList.createEl("li", {
			text: "Stdio servers: use 'command' and 'args' fields.",
		});
		infoList.createEl("li", { text: "Sse servers: use 'URL' field" });
		infoList.createEl("li", {
			text: "Environment variables: use 'env' object",
		});
		infoList.createEl("li", {
			text: "Server names will be generated from the keys",
		});

		// Buttons
		const buttonContainer = contentEl.createDiv({
			cls: "hydrate-modal-button-container",
		});

		new ButtonComponent(buttonContainer)
			.setButtonText("Save configuration")
			.setCta()
			.onClick(() => {
				if (this.validateAndSave()) {
					this.close();
				}
			});

		const cancelButton = buttonContainer.createEl("button", {
			text: "Cancel",
		});
		cancelButton.onclick = () => this.close();
	}

	private configsToJson(configs: MCPServerConfig[]): string {
		const mcpServers: Record<string, Record<string, unknown>> = {};

		configs.forEach((config) => {
			const serverConfig: Record<string, unknown> = {};

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
			2,
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
				([serverId, serverConfig]: [
					string,
					Record<string, unknown>,
				]) => {
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
							url: serverConfig.url as string,
						};
					} else if (serverConfig.command) {
						config.transport = { type: "stdio" };
						config.command = serverConfig.command as string;
						config.args = (serverConfig.args as string[]) || [];
					} else {
						throw new Error(
							`Server '${serverId}' must have either 'url' or 'command' field`,
						);
					}

					// Generate a better display name
					config.name = serverId;

					// Set environment variables
					if (
						serverConfig.env &&
						typeof serverConfig.env === "object"
					) {
						config.env = {};
						// Convert all environment variable values to strings
						for (const [key, value] of Object.entries(
							serverConfig.env as Record<string, unknown>,
						)) {
							config.env[key] = String(value);
						}
					}

					configs.push(config);
				},
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
						`Server '${config.id}': URL is required for SSE transport`,
					);
					return false;
				}
				if (config.transport.type === "stdio" && !config.command) {
					this.showError(
						`Server '${config.id}': Command is required for STDIO transport`,
					);
					return false;
				}
			}

			this.onSave(configs);
			new Notice(
				`Successfully configured ${configs.length} MCP server${
					configs.length === 1 ? "" : "s"
				}`,
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
		const errorEl = this.contentEl.createDiv({ cls: "hydrate-mcp-error" });
		errorEl.addClass("hydrate-mcp-error");
		errorEl.textContent = message;

		setTimeout(() => errorEl.remove(), 5000);
	}
}
