import {
	App,
	PluginSettingTab,
	Setting,
	Notice,
	TextComponent,
	ButtonComponent,
} from "obsidian";
import HydratePlugin, { ALLOWED_MODELS, ModelName } from "../main"; // Corrected path & ADDED IMPORTS
import { RegistryEditModal } from "./RegistryEditModal";
import { RuleEditModal } from "./RuleEditModal"; // <<< IMPORT NEW MODAL
import { MCPServersConfigModal } from "./MCPServerEditModal";
// MCPServerSettingsModal removed - functionality integrated into main settings
import { injectSettingsStyles } from "../styles/settingsStyles";
import { RuleEntry } from "../types"; // <<< IMPORT RuleEntry
import {
	MCPServerConfig,
	MCPServerStatus,
	MCPServerHealth,
} from "../mcp/MCPServerConfig"; // <<< IMPORT MCP TYPES

export class HydrateSettingTab extends PluginSettingTab {
	plugin: HydratePlugin;
	startIndexingButton: ButtonComponent | null = null;

	constructor(app: App, plugin: HydratePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", { text: "Hydrate Settings" });

		// --- General Settings ---
		containerEl.createEl("h3", { text: "General" });
		new Setting(containerEl)
			.setName("Default Pane Orientation")
			.setDesc("Choose where the Hydrate pane opens by default.")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("Bottom", "Bottom") // Horizontal split
					.addOption("Right", "Right") // Vertical split
					.setValue(this.plugin.settings.paneOrientation)
					.onChange(async (value: "Bottom" | "Right") => {
						this.plugin.settings.paneOrientation = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Default LLM Model")
			.setDesc(
				"Select the language model to use for the agent. Ensure you have the corresponding API key set in the backend environment (e.g., .env file with OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY)."
			)
			.addDropdown((dropdown) => {
				// Add options dynamically from the allowed list
				ALLOWED_MODELS.forEach((modelName) => {
					dropdown.addOption(modelName, modelName);
				});

				dropdown
					.setValue(this.plugin.getSelectedModel()) // Use getter to ensure valid value
					.onChange(async (value: ModelName) => {
						this.plugin.settings.selectedModel = value;
						await this.plugin.saveSettings();
						new Notice(`Default model set to: ${value}`);
					});
			});

		new Setting(containerEl)
			.setName("Backend URL")
			.setDesc(
				"URL of the Hydrate agent backend (e.g., http://localhost:8000)."
			)
			.addText((text) => {
				text.setPlaceholder("http://localhost:8000")
					.setValue(this.plugin.settings.backendUrl)
					.onChange(async (value) => {
						const trimmedValue = value.trim().replace(/\/$/, ""); // Trim and remove trailing slash
						if (
							trimmedValue === "" ||
							trimmedValue.startsWith("http://") ||
							trimmedValue.startsWith("https://")
						) {
							this.plugin.settings.backendUrl = trimmedValue;
							await this.plugin.saveSettings();
							text.inputEl.removeClass("hydrate-input-error");
						} else {
							// Keep the invalid value in the input for correction, but don't save it.
							// Show persistent error styling instead of notice spam.
							text.inputEl.addClass("hydrate-input-error");
						}
					});
				// Add input listener to clear error on valid input
				text.inputEl.addEventListener("input", () => {
					const trimmedValue = text.inputEl.value
						.trim()
						.replace(/\/$/, "");
					if (
						trimmedValue === "" ||
						trimmedValue.startsWith("http://") ||
						trimmedValue.startsWith("https://")
					) {
						text.inputEl.removeClass("hydrate-input-error");
					} else {
						text.inputEl.addClass("hydrate-input-error");
					}
				});
			});

		// --- ADDED API KEY SETTING ---
		new Setting(containerEl)
			.setName("API Key")
			.setDesc(
				"The API key required to authenticate with the backend service. This must match the HYDRATE_API_KEY on the server."
			)
			.addText((text) =>
				text
					.setPlaceholder("Enter your API key")
					.setValue(this.plugin.settings.apiKey) // Use the apiKey setting
					.onChange(async (value) => {
						// Basic trim, no complex validation needed here
						this.plugin.settings.apiKey = value.trim();
						await this.plugin.saveSettings();
						// Optionally add a notice, though maybe not necessary for key changes
						// new Notice("API Key updated.");
					})
			);
		// --- END ADDED API KEY SETTING ---

		// --- Format & Context Registry Section ---
		const formatRegistrySection = containerEl.createDiv(
			"hydrate-settings-section"
		);
		const formatHeadingEl = formatRegistrySection.createEl("div", {
			cls: "hydrate-settings-heading",
		});
		formatHeadingEl.createEl("h3", { text: "Format & Context Registry" });
		const formatAddButtonContainer = formatHeadingEl.createDiv({
			cls: "hydrate-heading-actions",
		}); // Container for button

		// Add New Entry Button (aligned with heading)
		formatAddButtonContainer
			.createEl("button", { text: "Add New Entry", cls: "mod-cta" })
			.addEventListener("click", () => {
				const modal = new RegistryEditModal(
					this.app,
					this.plugin,
					null, // Creating a new entry
					(newEntry) => {
						// Add the new entry to settings
						this.plugin.settings.registryEntries = [
							...this.plugin.getRegistryEntries(), // Use getter to ensure array exists
							newEntry,
						];
						this.plugin.saveSettings();
						this.renderFormatRegistryList(formatRegistryListEl); // Use specific renderer
						new Notice(
							`Added format entry: ${
								newEntry.description || newEntry.id
							}`
						);
					}
				);
				modal.open();
			});

		formatRegistrySection.createEl("p", {
			text: "Manage reusable templates, schemas, or context snippets accessible via slash commands in the Hydrate pane.",
			cls: "setting-item-description", // Use Obsidian's class
		});

		const formatRegistryListEl = formatRegistrySection.createDiv(
			"hydrate-registry-list"
		); // Container for the list items

		this.renderFormatRegistryList(formatRegistryListEl); // Call helper to render the list items

		// --- Rules Registry Section ---
		const rulesRegistrySection = containerEl.createDiv(
			"hydrate-settings-section"
		);
		const rulesHeadingEl = rulesRegistrySection.createEl("div", {
			cls: "hydrate-settings-heading",
		});
		rulesHeadingEl.createEl("h3", { text: "Rules Registry" });
		const rulesAddButtonContainer = rulesHeadingEl.createDiv({
			cls: "hydrate-heading-actions",
		});
		rulesAddButtonContainer
			.createEl("button", { text: "Add New Rule", cls: "mod-cta" })
			.addEventListener("click", () => {
				const modal = new RuleEditModal( // Use new modal
					this.app,
					this.plugin,
					null, // Creating a new rule
					(newRule) => {
						// Add the new rule to settings
						this.plugin.settings.rulesRegistryEntries = [
							...this.plugin.getRulesRegistryEntries(), // Use rules getter
							newRule,
						];
						this.plugin.saveSettings();
						this.renderRulesRegistryList(rulesRegistryListEl); // Re-render the rules list
						new Notice(
							`Added rule: ${newRule.description || newRule.id}`
						);
					}
				);
				modal.open();
			});
		rulesRegistrySection.createEl("p", {
			text: "Manage rules applied to agent context based on `hydrate-rule` tags in file frontmatter.",
			cls: "setting-item-description",
		});
		const rulesRegistryListEl = rulesRegistrySection.createDiv(
			"hydrate-registry-list"
		);
		this.renderRulesRegistryList(rulesRegistryListEl); // Call rules list renderer

		// --- MCP Servers Section ---
		const mcpServersSection = containerEl.createDiv(
			"hydrate-settings-section"
		);
		const mcpHeadingEl = mcpServersSection.createEl("div", {
			cls: "hydrate-settings-heading",
		});
		mcpHeadingEl.createEl("h3", { text: "MCP Servers" });
		const mcpAddButtonContainer = mcpHeadingEl.createDiv({
			cls: "hydrate-heading-actions",
		});
		mcpAddButtonContainer
			.createEl("button", {
				text: "Configure MCP Servers",
				cls: "mod-cta",
			})
			.addEventListener("click", () => {
				const modal = new MCPServersConfigModal(
					this.app,
					this.plugin.settings.mcpServers || [],
					async (newServers) => {
						// Debug: Log the server names being saved
						console.log(
							"Saving MCP servers:",
							newServers.map((s) => ({ id: s.id, name: s.name }))
						);

						// Save to settings
						this.plugin.settings.mcpServers = newServers;
						await this.plugin.saveSettings();

						// Update MCP Server Manager
						if (this.plugin.mcpManager) {
							// Remove all existing servers
							const existingIds =
								this.plugin.mcpManager.getServerIds();
							for (const id of existingIds) {
								try {
									await this.plugin.mcpManager.removeServer(
										id
									);
								} catch (error) {
									console.warn(
										`Failed to remove server ${id}:`,
										error
									);
								}
							}

							// Add new servers
							for (const config of newServers) {
								try {
									await this.plugin.mcpManager.addServer(
										config.id,
										config
									);
									console.log(
										`Added MCP server: ${config.id}`
									);
								} catch (error) {
									console.error(
										`Failed to add server ${config.id}:`,
										error
									);
								}
							}
						}

						this.display();
						new Notice(
							`Configured ${newServers.length} MCP server${
								newServers.length === 1 ? "" : "s"
							}`
						);
					}
				);
				modal.open();
			});

		mcpServersSection.createEl("p", {
			text: "Configure Model Context Protocol (MCP) servers to extend agent capabilities with external tools and data sources.",
			cls: "setting-item-description",
		});

		const mcpServersListEl = mcpServersSection.createDiv(
			"hydrate-registry-list"
		);
		this.renderMCPServersList(mcpServersListEl);

		// --- MCP PATH Configuration ---
		new Setting(containerEl)
			.setName("MCP Custom PATH")
			.setDesc(
				"Comma-separated list of paths to add to PATH environment variable when starting MCP servers. This is needed if Obsidian can't find 'npx' or 'node'. Example: /usr/local/bin,/opt/homebrew/bin"
			)
			.addText((text) =>
				text
					.setPlaceholder("/usr/local/bin,/opt/homebrew/bin")
					.setValue(this.plugin.settings.mcpCustomPaths)
					.onChange(async (value) => {
						this.plugin.settings.mcpCustomPaths = value.trim();
						await this.plugin.saveSettings();
					})
			);

		// --- Remote Embeddings Section ---
		containerEl.createEl("h3", { text: "Remote Embeddings Configuration" });

		new Setting(containerEl)
			.setName("Enable Remote Embeddings")
			.setDesc(
				"Use a remote API endpoint (like OpenAI) to generate embeddings instead of running a local model. Requires separate configuration below."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableRemoteEmbeddings)
					.onChange(async (value) => {
						this.plugin.settings.enableRemoteEmbeddings = value;
						await this.plugin.saveSettings();
						this.display();
					})
			);

		if (this.plugin.settings.enableRemoteEmbeddings) {
			new Setting(containerEl)
				.setName("Embedding API URL")
				.setDesc(
					"The full URL of the OpenAI-compatible embedding API endpoint."
				)
				.addText((text) =>
					text
						.setPlaceholder(
							"e.g., https://api.openai.com/v1/embeddings"
						)
						.setValue(this.plugin.settings.remoteEmbeddingUrl)
						.onChange(async (value) => {
							this.plugin.settings.remoteEmbeddingUrl =
								value.trim();
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName("Embedding API Key")
				.setDesc(
					"Your API key for the embedding service. Will be sent with requests. Ensure you trust the endpoint."
				)
				.addText((text) => {
					text.setPlaceholder("Enter API key (e.g., sk-...)")
						.setValue(this.plugin.settings.remoteEmbeddingApiKey)
						.onChange(async (value: string) => {
							this.plugin.settings.remoteEmbeddingApiKey =
								value.trim();
							await this.plugin.saveSettings();
						});

					text.inputEl.type = "password";
				});

			new Setting(containerEl)
				.setName("Embedding Model Name")
				.setDesc(
					"The exact name of the embedding model to use with the API (e.g., text-embedding-3-small)."
				)
				.addText((text) =>
					text
						.setPlaceholder("e.g., text-embedding-3-small")
						.setValue(this.plugin.settings.remoteEmbeddingModelName)
						.onChange(async (value) => {
							this.plugin.settings.remoteEmbeddingModelName =
								value.trim();
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName("Indexed File Extensions")
				.setDesc(
					"Comma-separated list of file extensions to index (e.g., md,txt,js). Leave empty to index no files. Changes require re-indexing."
				)
				.addText((text) =>
					text
						.setPlaceholder("e.g., md,txt,js")
						.setValue(this.plugin.settings.indexFileExtensions)
						.onChange(async (value) => {
							this.plugin.settings.indexFileExtensions = value
								.split(",")
								.map((ext) => ext.trim().toLowerCase())
								.filter((ext) => ext.length > 0)
								.join(",");
							await this.plugin.saveSettings();
						})
				);

			const indexingDesc = document.createDocumentFragment();
			indexingDesc.append(
				"Scan the entire vault and generate embeddings for specified file types using the configured remote endpoint.",
				indexingDesc.createEl("br"),
				indexingDesc.createEl("strong", { text: "Warning:" }),
				" This may take a long time and may incur costs."
			);

			new Setting(containerEl)
				.setName("Re-index Entire Vault")
				.setDesc(indexingDesc)
				.addButton((button) => {
					this.startIndexingButton = button
						.setButtonText("Start Full Vault Indexing")
						.setCta()
						.onClick(async () => {
							if (this.plugin.isIndexing) {
								new Notice("Indexing is already in progress.");
								return;
							}
							if (this.startIndexingButton) {
								this.startIndexingButton.setDisabled(true);
								this.startIndexingButton.setButtonText(
									"Indexing..."
								);
							}
							try {
								await this.plugin.triggerInitialIndexing();
							} catch (error) {
								console.error(
									"Initial indexing trigger failed:",
									error
								);
								new Notice(
									"Failed to start indexing. Check console."
								);
							} finally {
								if (this.startIndexingButton) {
									this.startIndexingButton.setDisabled(false);
									this.startIndexingButton.setButtonText(
										"Start Full Vault Indexing"
									);
								}
							}
						});
					if (this.plugin.isIndexing) {
						button.setDisabled(true);
						button.setButtonText("Indexing...");
					}
				});
		}

		// --- Inject CSS --- <<< CALL INJECTOR FUNCTION
		injectSettingsStyles(this.plugin);
	}

	// --- Helper to Render the Format Registry List ---
	renderFormatRegistryList(containerEl: HTMLElement) {
		containerEl.empty(); // Clear previous list

		const entries = this.plugin.getRegistryEntries(); // Use getter

		if (entries.length === 0) {
			containerEl.createEl("p", {
				text: "No format entries defined yet. Click 'Add New Entry' above to create one.",
				cls: "hydrate-empty-list-message", // Custom class for styling
			});
			return;
		}

		// Sort alphabetically by description for consistent order
		entries.sort((a, b) =>
			(a.description || a.id).localeCompare(b.description || b.id)
		);

		entries.forEach((entry) => {
			const settingItem = new Setting(containerEl)
				.setName(entry.description || `(ID: ${entry.id})`) // Show ID if no description
				.setDesc(
					`Trigger: ${entry.slashCommandTrigger || "None"} | Type: ${
						entry.contentType
					} | v${entry.version}`
				)
				.setClass("hydrate-registry-item") // Custom class for item styling

				// Edit Button
				.addButton((button) =>
					button
						.setIcon("pencil") // Use Obsidian's pencil icon
						.setTooltip("Edit Format Entry") // Updated tooltip
						.onClick(() => {
							const modal = new RegistryEditModal(
								this.app,
								this.plugin,
								entry, // Pass the existing entry (modal constructor makes a copy)
								(updatedEntry) => {
									// Update the entry in the settings array
									this.plugin.settings.registryEntries =
										this.plugin
											.getRegistryEntries()
											.map((e) =>
												e.id === updatedEntry.id
													? updatedEntry
													: e
											);
									this.plugin.saveSettings();
									this.renderFormatRegistryList(containerEl); // Use specific renderer
									new Notice(
										`Updated format entry: ${
											updatedEntry.description ||
											updatedEntry.id
										}`
									);
								}
							);
							modal.open();
						})
				)
				// Delete Button
				.addButton((button) =>
					button
						.setIcon("trash") // Use Obsidian's trash icon
						.setTooltip("Delete Format Entry") // Updated tooltip
						.setClass("mod-warning") // Use Obsidian's warning style for delete
						.onClick(async () => {
							// Simple confirmation using window.confirm (consider a custom modal for better UX)
							if (
								confirm(
									`Are you sure you want to delete "${
										entry.description || entry.id
									}"?`
								)
							) {
								this.plugin.settings.registryEntries =
									this.plugin
										.getRegistryEntries()
										.filter((e) => e.id !== entry.id); // Filter out the entry
								await this.plugin.saveSettings();
								this.renderFormatRegistryList(containerEl); // Use specific renderer
								new Notice(
									`Deleted format entry: ${
										entry.description || entry.id
									}`
								);
							}
						})
				);
		});
	}

	// --- Helper to Render the Rules Registry List ---
	renderRulesRegistryList(containerEl: HTMLElement) {
		containerEl.empty(); // Clear previous list

		const rules = this.plugin.getRulesRegistryEntries(); // Use rules getter

		if (rules.length === 0) {
			containerEl.createEl("p", {
				text: "No rules defined yet. Click 'Add New Rule' above to create one.",
				cls: "hydrate-empty-list-message",
			});
			return;
		}

		// Sort alphabetically by description or ID for consistent order
		rules.sort((a, b) =>
			(a.description || a.id).localeCompare(b.description || b.id)
		);

		rules.forEach((rule) => {
			const settingItem = new Setting(containerEl)
				.setName(rule.description || `(ID: ${rule.id})`) // Show ID if no description
				.setDesc(`Tag: ${rule.id} | v${rule.version}`)
				.setClass("hydrate-registry-item") // Reuse existing class

				// Edit Button
				.addButton((button) =>
					button
						.setIcon("pencil")
						.setTooltip("Edit Rule")
						.onClick(() => {
							const modal = new RuleEditModal(
								this.app,
								this.plugin,
								rule, // Pass the existing rule
								(updatedRule) => {
									// Update the rule in the settings array
									this.plugin.settings.rulesRegistryEntries =
										this.plugin
											.getRulesRegistryEntries()
											.map((r) =>
												r.id === updatedRule.id
													? updatedRule
													: r
											);
									this.plugin.saveSettings();
									this.renderRulesRegistryList(containerEl); // Re-render this list
									new Notice(
										`Updated rule: ${
											updatedRule.description ||
											updatedRule.id
										}`
									);
								}
							);
							modal.open();
						})
				)
				// Delete Button
				.addButton((button) =>
					button
						.setIcon("trash")
						.setTooltip("Delete Rule")
						.setClass("mod-warning")
						.onClick(async () => {
							if (
								confirm(
									`Are you sure you want to delete the rule "${
										rule.description || rule.id
									}"?`
								)
							) {
								this.plugin.settings.rulesRegistryEntries =
									this.plugin
										.getRulesRegistryEntries()
										.filter((r) => r.id !== rule.id); // Filter out the rule
								await this.plugin.saveSettings();
								this.renderRulesRegistryList(containerEl); // Re-render this list
								new Notice(
									`Deleted rule: ${
										rule.description || rule.id
									}`
								);
							}
						})
				);
		});
	}

	// --- Helper to Render the MCP Servers List ---
	renderMCPServersList(containerEl: HTMLElement) {
		containerEl.empty();
		const servers = this.plugin.settings.mcpServers || [];

		if (servers.length === 0) {
			containerEl.createEl("p", {
				text: "No MCP servers configured. Add a server to extend tool capabilities.",
				cls: "hydrate-empty-list-message",
			});
			return;
		}

		servers.forEach((server, index) => {
			const serverRow = containerEl.createDiv("hydrate-mcp-server-row");

			// Server Info
			const serverInfo = serverRow.createDiv("hydrate-mcp-server-info");
			const serverTitle = serverInfo.createEl("div", {
				cls: "hydrate-mcp-server-title",
			});
			serverTitle.createEl("strong", { text: server.name || server.id });

			// Health Indicator
			const healthIndicator = serverTitle.createEl("span", {
				cls: "hydrate-mcp-health",
			});
			const healthStatus = this.getServerHealthStatus(server);
			healthIndicator.textContent = healthStatus.indicator;
			healthIndicator.title = healthStatus.tooltip;
			healthIndicator.className = `hydrate-mcp-health ${healthStatus.class}`;

			// Optional: Show basic transport type only
			if (server.transport?.type === "sse" || server.command) {
				const serverDetails = serverInfo.createEl("div", {
					cls: "hydrate-mcp-server-details",
				});
				const transportType =
					server.transport?.type === "sse" ? "SSE" : "STDIO";
				serverDetails.createEl("span", { text: transportType });
			}

			// Server Controls
			const serverControls = serverRow.createDiv(
				"hydrate-mcp-server-controls"
			);

			// Enable/Disable Toggle
			const toggleContainer =
				serverControls.createDiv("hydrate-mcp-toggle");
			const toggle = toggleContainer.createEl("input", {
				type: "checkbox",
				cls: "hydrate-mcp-checkbox",
			});
			toggle.checked = server.enabled !== false;
			toggle.onchange = async () => {
				server.enabled = toggle.checked;
				await this.plugin.saveSettings();
				// Restart server if it was running
				if (this.plugin.mcpManager) {
					if (toggle.checked) {
						this.plugin.mcpManager.startServer(server.id);
					} else {
						this.plugin.mcpManager.stopServer(server.id);
					}
				}
				this.renderMCPServersList(containerEl);
			};
			toggleContainer.createEl("label", {
				text: toggle.checked ? "Enabled" : "Disabled",
				cls: toggle.checked
					? "hydrate-mcp-enabled"
					: "hydrate-mcp-disabled",
			});

			// Action Buttons
			const actionButtons = serverControls.createDiv(
				"hydrate-mcp-actions"
			);

			// Settings Button
			const settingsButton = actionButtons.createEl("button", {
				text: "Settings",
				cls: "hydrate-mcp-action-btn",
			});
			settingsButton.onclick = () => {
				new MCPServerSettingsModal(this.app, server, (updatedServer) =>
					this.updateServerSettings(index, updatedServer)
				).open();
			};

			// Test Button
			const testButton = actionButtons.createEl("button", {
				text: "Test",
				cls: "hydrate-mcp-action-btn",
			});
			testButton.onclick = () => this.testServerConnection(server);
		});
	}

	private addOrUpdateServer(config: MCPServerConfig, index?: number) {
		const servers = [...(this.plugin.settings.mcpServers || [])];

		if (index !== undefined) {
			// Update existing server
			servers[index] = config;
		} else {
			// Add new server - check for duplicates
			const existingIndex = servers.findIndex((s) => s.id === config.id);
			if (existingIndex !== -1) {
				// Update existing instead of creating duplicate
				servers[existingIndex] = config;
			} else {
				servers.push(config);
			}
		}

		this.plugin.settings.mcpServers = servers;
		this.plugin.saveSettings();

		// Refresh the display
		this.display();

		// Start the server if enabled
		if (config.enabled && this.plugin.mcpManager) {
			this.plugin.mcpManager.startServer(config.id);
		}
	}

	private async testServerConnection(server: MCPServerConfig) {
		if (!this.plugin.mcpManager) {
			new Notice("MCP Manager not available");
			return;
		}

		try {
			new Notice("Testing server connection...");
			const result = await this.plugin.mcpManager.testServerConnection(
				server
			);

			if (result.success) {
				new Notice(
					`✅ ${server.name}: Connected successfully! Found ${
						result.toolCount || 0
					} tools.`
				);
			} else {
				new Notice(
					`❌ ${server.name}: Connection failed - ${result.error}`
				);
			}
		} catch (error) {
			new Notice(`❌ ${server.name}: Test failed - ${error.message}`);
		}
	}

	private deleteServer(index: number) {
		const servers = [...(this.plugin.settings.mcpServers || [])];
		const server = servers[index];

		// Stop server if running
		if (this.plugin.mcpManager) {
			this.plugin.mcpManager.stopServer(server.id);
		}

		servers.splice(index, 1);
		this.plugin.settings.mcpServers = servers;
		this.plugin.saveSettings();
		this.display();

		new Notice(`Removed server: ${server.name || server.id}`);
	}

	private getMCPServerStatusText(server: MCPServerConfig): string {
		if (!server.enabled) return "Disabled";

		// Try to get actual status from MCP manager
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

	private getMCPServerStatusClass(server: MCPServerConfig): string {
		if (!server.enabled) return "mcp-status-disabled";

		if (this.plugin.mcpManager) {
			const status = this.plugin.mcpManager.getServerStatus(server.id);
			if (status) {
				switch (status) {
					case MCPServerStatus.RUNNING:
						return "mcp-status-running";
					case MCPServerStatus.STARTING:
					case MCPServerStatus.RESTARTING:
						return "mcp-status-starting";
					case MCPServerStatus.CRASHED:
					case MCPServerStatus.FAILED:
						return "mcp-status-error";
					default:
						return "mcp-status-stopped";
				}
			}
		}

		return "mcp-status-unknown";
	}

	private getServerHealthStatus(server: MCPServerConfig): {
		indicator: string;
		tooltip: string;
		class: string;
	} {
		if (!server.enabled) {
			return {
				indicator: "⚫",
				tooltip: "Server disabled",
				class: "disabled",
			};
		}

		// Check if server is running via MCP manager
		if (this.plugin.mcpManager) {
			const status = this.plugin.mcpManager.getServerStatus?.(server.id);
			switch (status) {
				case MCPServerStatus.RUNNING:
					return {
						indicator: "🟢",
						tooltip: "Server running",
						class: "healthy",
					};
				case MCPServerStatus.STARTING:
				case MCPServerStatus.RESTARTING:
					return {
						indicator: "🟡",
						tooltip: "Server starting",
						class: "starting",
					};
				case MCPServerStatus.CRASHED:
				case MCPServerStatus.FAILED:
					return {
						indicator: "🔴",
						tooltip: "Server failed",
						class: "unhealthy",
					};
				case MCPServerStatus.STOPPING:
					return {
						indicator: "🟡",
						tooltip: "Server stopping",
						class: "stopping",
					};
				default:
					return {
						indicator: "⚪",
						tooltip: "Server stopped",
						class: "stopped",
					};
			}
		}

		return {
			indicator: "🟡",
			tooltip: "Server status unknown",
			class: "unknown",
		};
	}

	private updateServerSettings(
		index: number,
		updatedServer: MCPServerConfig
	) {
		this.plugin.settings.mcpServers[index] = updatedServer;
		this.plugin.saveSettings();
		this.display(); // Refresh the entire display
	}
}
