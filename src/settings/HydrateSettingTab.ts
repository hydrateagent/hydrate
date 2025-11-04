import {
	App,
	PluginSettingTab,
	Setting,
	Notice,
	TextComponent,
	ButtonComponent,
	Modal,
} from "obsidian";
import HydratePlugin, { ALLOWED_MODELS, ModelName } from "../main"; // Corrected path & ADDED IMPORTS
import { RegistryEditModal } from "./RegistryEditModal";
import { RuleEditModal } from "./RuleEditModal"; // <<< IMPORT NEW MODAL
import { MCPServersConfigModal } from "./MCPServerEditModal";
import { devLog } from "../utils/logger";
import { MCPServerSettingsModal } from "./MCPServerSettingsModal"; // <<< IMPORT MCP SERVER MODAL
// Settings styles are now compiled into styles.css via hydrate-styles.css
import { RuleEntry } from "../types"; // <<< IMPORT RuleEntry
import {
	MCPServerConfig,
	MCPServerStatus,
	MCPServerHealth,
} from "../mcp/MCPServerConfig"; // <<< IMPORT MCP TYPES

export class HydrateSettingTab extends PluginSettingTab {
	plugin: HydratePlugin;
	startIndexingButton: ButtonComponent | null = null;
	private mcpServersContainer: HTMLElement | null = null;
	private serverStatusListeners = new Map<
		string,
		(...args: unknown[]) => void
	>();

	constructor(app: App, plugin: HydratePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	hide(): void {
		this.removeStatusListeners();
		super.hide();
	}

	private setupStatusListeners(): void {
		if (!this.plugin.mcpManager) return;

		// Store event handlers so we can remove them properly
		const statusChangeHandler = (
			serverId: string,
			status: MCPServerStatus,
			previousStatus: MCPServerStatus,
		) => {
			if (this.mcpServersContainer) {
				this.renderMCPServersList(this.mcpServersContainer);
			}
		};

		const healthChangeHandler = (
			serverId: string,
			health: MCPServerHealth,
			previousHealth: MCPServerHealth,
		) => {
			if (this.mcpServersContainer) {
				this.renderMCPServersList(this.mcpServersContainer);
			}
		};

		// Listen for server status changes and update UI
		this.plugin.mcpManager.on("server-status-changed", statusChangeHandler);
		this.plugin.mcpManager.on("server-health-changed", healthChangeHandler);

		// Store handlers for cleanup
		this.serverStatusListeners.set("status", statusChangeHandler);
		this.serverStatusListeners.set("health", healthChangeHandler);
	}

	private removeStatusListeners(): void {
		if (this.plugin.mcpManager) {
			const statusHandler = this.serverStatusListeners.get("status");
			const healthHandler = this.serverStatusListeners.get("health");

			if (statusHandler) {
				this.plugin.mcpManager.off(
					"server-status-changed",
					statusHandler,
				);
			}
			if (healthHandler) {
				this.plugin.mcpManager.off(
					"server-health-changed",
					healthHandler,
				);
			}
		}
		this.serverStatusListeners.clear();
	}

	private isDevelopmentMode(): boolean {
		// Only use the build-time NODE_ENV
		return process.env.NODE_ENV === "development";
	}

	private getBackendUrl(): string {
		// Use the plugin's getBackendUrl method for consistent behavior
		return this.plugin.getBackendUrl();
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		// --- General Settings ---

		new Setting(containerEl)
			.setName("Default LLM model")
			.setDesc(
				"Select the language model to use for the agent. Ensure you have the corresponding API key set in the backend environment (e.g., .env file with OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY).",
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

		// Only show backend URL in development mode
		if (this.isDevelopmentMode()) {
			new Setting(containerEl)
				.setName("Backend URL")
				.setDesc(
					"URL of the Hydrate agent backend (e.g., http://localhost:8000). In production, this is hardcoded to https://api.hydrateagent.com/",
				)
				.addText((text) => {
					text.setPlaceholder("http://localhost:8000")
						.setValue(this.plugin.settings.backendUrl)
						.onChange(async (value) => {
							const trimmedValue = value
								.trim()
								.replace(/\/$/, ""); // Trim and remove trailing slash
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
		}

		// --- BYOK SUBSCRIPTION SETTINGS ---
		new Setting(containerEl)
			.setName("Subscription & API keys")
			.setHeading();

		// Subscription Status Display
		const subscriptionStatusSection = containerEl.createEl("div", {
			cls: "hydrate-subscription-status",
		});

		if (this.plugin.settings.licenseKey) {
			subscriptionStatusSection.createEl("h4", {
				text: "Subscription status",
			});
			const statusDiv = subscriptionStatusSection.createEl("div", {
				cls: "hydrate-subscription-status-display",
			});
			statusDiv.createEl("p", { text: "Loading subscription status..." });
			this.loadSubscriptionStatus(statusDiv);
		} else {
			subscriptionStatusSection.createEl("h4", {
				text: "Current tier: free",
			});
			const freeInfoDiv = subscriptionStatusSection.createEl("div", {
				cls: "hydrate-subscription-info",
			});
			freeInfoDiv.createEl("p", {
				text: "You're currently using the free tier. Configure your API keys below to get started, or upgrade to a paid tier for advanced features.",
				cls: "hydrate-subscription-description",
			});

			const featuresList = freeInfoDiv.createEl("ul", {
				cls: "hydrate-free-features-list",
			});
			featuresList.createEl("li", {
				text: "✓ Basic AI chat with your own API keys",
			});
			featuresList.createEl("li", {
				text: "✓ File operations and editing",
			});
			featuresList.createEl("li", {
				text: "✗ MCP server integrations (Pro+)",
			});
			featuresList.createEl("li", {
				text: "✗ Advanced file operations (Pro+)",
			});
			featuresList.createEl("li", { text: "✗ Priority support (Pro+)" });
		}

		new Setting(containerEl)
			.setName("License key")
			.setDesc(
				"Enter your Hydrate license key for paid subscriptions. Leave empty for free tier.",
			)
			.addText((text) =>
				text
					.setPlaceholder("Enter your license key")
					.setValue(this.plugin.settings.licenseKey)
					.onChange(async (value) => {
						this.plugin.settings.licenseKey = value.trim();
						await this.plugin.saveSettings();
						// Refresh the display to show/hide subscription status
						this.display();
					}),
			);
		// Add a link to the Hydrate home page for subscriptions
		const licenseLink = document.createElement("a");
		licenseLink.href = "https://hydrateagent.com";
		licenseLink.target = "_blank";
		licenseLink.rel = "noopener noreferrer";
		licenseLink.addClass("hydrate-license-link");
		licenseLink.textContent =
			"Get a subscription or manage your license at hydrateagent.com";
		containerEl.appendChild(licenseLink);

		const apiKeysDesc = containerEl.createEl("p", {
			text: "Configure your API keys for LLM providers. These are sent securely to the Hydrate service but never stored permanently.",
			cls: "setting-item-description",
		});
		apiKeysDesc.addClass("hydrate-api-keys-desc");

		new Setting(containerEl)
			.setName("OpenAI API key")
			.setDesc("Required for GPT models")
			.addText((text) => {
				let visible = false;
				text.setPlaceholder("sk-...")
					.setValue(this.plugin.settings.openaiApiKey)
					.onChange(async (value) => {
						this.plugin.settings.openaiApiKey = value.trim();
						await this.plugin.saveSettings();
					});
				text.inputEl.type = "password";
				// Add flat eye icon button
				const eyeBtn = document.createElement("button");
				eyeBtn.type = "button";
				eyeBtn.addClass("hydrate-eye-button");
				const eyeChar = document.createTextNode("\u{1F441}");
				eyeBtn.appendChild(eyeChar);
				eyeBtn.onclick = (e) => {
					e.preventDefault();
					visible = !visible;
					text.inputEl.type = visible ? "text" : "password";
				};
				text.inputEl.parentElement?.appendChild(eyeBtn);
			});

		new Setting(containerEl)
			.setName("Anthropic API key")
			.setDesc("Required for Claude models")
			.addText((text) => {
				let visible = false;
				text.setPlaceholder("sk-ant-...")
					.setValue(this.plugin.settings.anthropicApiKey)
					.onChange(async (value) => {
						this.plugin.settings.anthropicApiKey = value.trim();
						await this.plugin.saveSettings();
					});
				text.inputEl.type = "password";
				// Add flat eye icon button
				const eyeBtn = document.createElement("button");
				eyeBtn.type = "button";
				eyeBtn.addClass("hydrate-eye-button");
				const eyeChar2 = document.createTextNode("\u{1F441}");
				eyeBtn.appendChild(eyeChar2);
				eyeBtn.onclick = (e) => {
					e.preventDefault();
					visible = !visible;
					text.inputEl.type = visible ? "text" : "password";
				};
				text.inputEl.parentElement?.appendChild(eyeBtn);
			});

		new Setting(containerEl)
			.setName("Google API key")
			.setDesc("Required for Gemini models")
			.addText((text) => {
				let visible = false;
				text.setPlaceholder("AIza...")
					.setValue(this.plugin.settings.googleApiKey)
					.onChange(async (value) => {
						this.plugin.settings.googleApiKey = value.trim();
						await this.plugin.saveSettings();
					});
				text.inputEl.type = "password";
				// Add flat eye icon button
				const eyeBtn = document.createElement("button");
				eyeBtn.type = "button";
				eyeBtn.addClass("hydrate-eye-button");
				const eyeChar3 = document.createTextNode("\u{1F441}");
				eyeBtn.appendChild(eyeChar3);
				eyeBtn.onclick = (e) => {
					e.preventDefault();
					visible = !visible;
					text.inputEl.type = visible ? "text" : "password";
				};
				text.inputEl.parentElement?.appendChild(eyeBtn);
			});

		// --- END BYOK SUBSCRIPTION SETTINGS ---

		// --- Format & context registry section ---
		const formatRegistrySection = containerEl.createDiv(
			"hydrate-settings-section",
		);
		const formatHeadingEl = formatRegistrySection.createEl("div", {
			cls: "hydrate-settings-heading",
		});
		new Setting(formatHeadingEl)
			.setName("Format & context registry")
			.setHeading();
		const formatAddButtonContainer = formatHeadingEl.createDiv({
			cls: "hydrate-heading-actions",
		}); // Container for button

		// Add New Entry Button (aligned with heading)
		new ButtonComponent(formatAddButtonContainer)
			.setButtonText("Add new entry")
			.setCta()
			.onClick(() => {
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
							}`,
						);
					},
				);
				modal.open();
			});

		formatRegistrySection.createEl("p", {
			text: "Manage reusable templates, schemas, or context snippets accessible via slash commands in the Hydrate pane.",
			cls: "setting-item-description", // Use Obsidian's class
		});

		const formatRegistryListEl = formatRegistrySection.createDiv(
			"hydrate-registry-list",
		); // Container for the list items

		this.renderFormatRegistryList(formatRegistryListEl); // Call helper to render the list items

		// --- Rules Registry Section ---
		const rulesRegistrySection = containerEl.createDiv(
			"hydrate-settings-section",
		);
		const rulesHeadingEl = rulesRegistrySection.createEl("div", {
			cls: "hydrate-settings-heading",
		});
		new Setting(rulesHeadingEl).setName("Rules Registry").setHeading();
		const rulesAddButtonContainer = rulesHeadingEl.createDiv({
			cls: "hydrate-heading-actions",
		});
		new ButtonComponent(rulesAddButtonContainer)
			.setButtonText("Add new rule")
			.setCta()
			.onClick(() => {
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
							`Added rule: ${newRule.description || newRule.id}`,
						);
					},
				);
				modal.open();
			});
		rulesRegistrySection.createEl("p", {
			text: "Manage rules applied to agent context based on `hydrate-rule` tags in file frontmatter.",
			cls: "setting-item-description",
		});
		const rulesRegistryListEl = rulesRegistrySection.createDiv(
			"hydrate-registry-list",
		);
		this.renderRulesRegistryList(rulesRegistryListEl); // Call rules list renderer

		// --- MCP Servers Section ---
		const mcpServersSection = containerEl.createDiv(
			"hydrate-settings-section",
		);
		const mcpHeadingEl = mcpServersSection.createEl("div", {
			cls: "hydrate-settings-heading",
		});
		new Setting(mcpHeadingEl).setName("MCP Servers").setHeading();
		const mcpAddButtonContainer = mcpHeadingEl.createDiv({
			cls: "hydrate-heading-actions",
		});
		new ButtonComponent(mcpAddButtonContainer)
			.setButtonText("Configure MCP servers")
			.setCta()
			.onClick(() => {
				const modal = new MCPServersConfigModal(
					this.app,
					this.plugin.settings.mcpServers || [],
					async (newServers) => {
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
										id,
									);
								} catch (error) {
									devLog.warn(
										`Failed to remove server ${id}:`,
										error,
									);
								}
							}

							// Add new servers
							for (const config of newServers) {
								try {
									await this.plugin.mcpManager.addServer(
										config.id,
										config,
									);
								} catch (error) {
									devLog.error(
										`Failed to add server ${config.id}:`,
										error,
									);
								}
							}
						}

						this.display();
						new Notice(
							`Configured ${newServers.length} MCP server${
								newServers.length === 1 ? "" : "s"
							}`,
						);
					},
				);
				modal.open();
			});

		mcpServersSection.createEl("p", {
			text: "Configure Model Context Protocol (MCP) servers to extend agent capabilities with external tools and data sources. Only available with paid plans.",
			cls: "setting-item-description",
		});

		const mcpServersListEl = mcpServersSection.createDiv(
			"hydrate-registry-list",
		);
		this.mcpServersContainer = mcpServersListEl;
		this.renderMCPServersList(mcpServersListEl);
		this.setupStatusListeners();

		// --- MCP PATH Configuration ---
		new Setting(containerEl)
			.setName("MCP custom PATH")
			.setDesc(
				"Comma-separated list of paths to add to PATH environment variable when starting MCP servers. This is needed if Obsidian can't find 'npx' or 'node'. Example: /usr/local/bin,/opt/homebrew/bin",
			)
			.addText((text) =>
				text
					.setPlaceholder("/usr/local/bin,/opt/homebrew/bin")
					.setValue(this.plugin.settings.mcpCustomPaths)
					.onChange(async (value) => {
						this.plugin.settings.mcpCustomPaths = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		// --- Embeddings Section ---
		new Setting(containerEl).setName("Embeddings").setHeading();

		// Add helpful notice for new users
		if (!this.plugin.settings.enableRemoteEmbeddings) {
			const noticeEl = containerEl.createDiv({
				cls: "hydrate-embeddings-notice",
			});
			noticeEl.createEl("p", {
				text: "💡 Enable embeddings to use AI-powered context search and document indexing. This requires an API key from a service like OpenAI.",
				cls: "hydrate-embeddings-help",
			});
		}

		new Setting(containerEl)
			.setName("Enable embeddings")
			.setDesc(
				"Use an API endpoint (like OpenAI) to generate embeddings instead of running a local model. Requires separate configuration below.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableRemoteEmbeddings)
					.onChange(async (value) => {
						this.plugin.settings.enableRemoteEmbeddings = value;
						await this.plugin.saveSettings();

						// Initialize vector system when embeddings are first enabled
						if (value) {
							try {
								await this.plugin.initializeVectorSystemIfNeeded();
								if (
									this.plugin.settings.remoteEmbeddingUrl &&
									this.plugin.settings.remoteEmbeddingApiKey
								) {
									new Notice(
										"Vector system initialized. You can now index your vault.",
									);
								}
							} catch (error) {
								devLog.error(
									"Failed to initialize vector system:",
									error,
								);
								new Notice(
									"Failed to initialize vector system. Check console for details.",
								);
							}
						}

						this.display();
					}),
			);

		if (this.plugin.settings.enableRemoteEmbeddings) {
			new Setting(containerEl)
				.setName("Embedding API URL")
				.setDesc(
					"The full URL of the OpenAI-compatible embedding API endpoint.",
				)
				.addText((text) =>
					text
						.setPlaceholder(
							"e.g., https://api.openai.com/v1/embeddings",
						)
						.setValue(this.plugin.settings.remoteEmbeddingUrl)
						.onChange(async (value) => {
							this.plugin.settings.remoteEmbeddingUrl =
								value.trim();
							await this.plugin.saveSettings();
						}),
				);

			new Setting(containerEl)
				.setName("Embedding API key")
				.setDesc(
					"Your API key for the embedding service. Will be sent with requests. Ensure you trust the endpoint.",
				)
				.addText((text) => {
					let visible = false;
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
				.setName("Embedding model name")
				.setDesc(
					"The exact name of the embedding model to use with the API (e.g., text-embedding-3-small).",
				)
				.addText((text) =>
					text
						.setPlaceholder("e.g., text-embedding-3-small")
						.setValue(this.plugin.settings.remoteEmbeddingModelName)
						.onChange(async (value) => {
							this.plugin.settings.remoteEmbeddingModelName =
								value.trim();
							await this.plugin.saveSettings();
						}),
				);

			new Setting(containerEl)
				.setName("Indexed file extensions")
				.setDesc(
					"Comma-separated list of file extensions to index (e.g., md,txt,js). Leave empty to index no files. Changes require re-indexing.",
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
						}),
				);

			const indexingDesc = document.createDocumentFragment();
			indexingDesc.append(
				"Scan the entire vault and generate embeddings for specified file types using the configured remote endpoint.",
				indexingDesc.createEl("br"),
				indexingDesc.createEl("strong", { text: "Warning:" }),
				" This may take a long time and may incur costs.",
			);

			new Setting(containerEl)
				.setName("Re-index entire vault")
				.setDesc(indexingDesc)
				.addButton((button) => {
					this.startIndexingButton = button
						.setButtonText("Start full vault indexing")
						.setCta()
						.onClick(async () => {
							if (this.plugin.isIndexing) {
								new Notice("Indexing is already in progress.");
								return;
							}
							if (this.startIndexingButton) {
								this.startIndexingButton.setDisabled(true);
								this.startIndexingButton.setButtonText(
									"Indexing...",
								);
							}
							try {
								await this.plugin.triggerInitialIndexing();
							} catch (error) {
								devLog.error(
									"Initial indexing trigger failed:",
									error,
								);
								new Notice(
									"Failed to start indexing. Check console.",
								);
							} finally {
								if (this.startIndexingButton) {
									this.startIndexingButton.setDisabled(false);
									this.startIndexingButton.setButtonText(
										"Start full vault indexing",
									);
								}
							}
						});
					if (this.plugin.isIndexing) {
						button.setDisabled(true);
						button.setButtonText("Indexing...");
					}
				})
				.addButton((button) => {
					button
						.setButtonText("Rebuild index")
						.setWarning()
						.setTooltip(
							"Clear corrupted index and rebuild from scratch",
						)
						.onClick(async () => {
							if (this.plugin.isIndexing) {
								new Notice("Indexing is already in progress.");
								return;
							}

							// Confirm before rebuilding
							const confirmed = await new Promise<boolean>(
								(resolve) => {
									const modal = new (class extends Modal {
										constructor(app: App) {
											super(app);
										}

										onOpen() {
											const { contentEl } = this;
											contentEl.createEl("h2", {
												text: "Rebuild vector index",
											});
											contentEl.createEl("p", {
												text: "This will completely delete the existing index and rebuild it from scratch. This is useful if you're experiencing search errors due to corrupted index data.",
											});
											contentEl.createEl("p", {
												text: "This operation cannot be undone and may take several minutes to complete.",
											});

											const buttonContainer =
												contentEl.createDiv({
													cls: "hydrate-modal-button-container",
												});
											buttonContainer.createEl("button", {
												text: "Cancel",
												cls: "mod-cancel",
											}).onclick = () => {
												resolve(false);
												this.close();
											};

											new ButtonComponent(buttonContainer)
												.setButtonText("Rebuild index")
												.setCta()
												.setWarning()
												.onClick(() => {
													resolve(true);
													this.close();
												});
										}

										onClose() {
											const { contentEl } = this;
											contentEl.empty();
										}
									})(this.app);
									modal.open();
								},
							);

							if (!confirmed) return;

							if (this.startIndexingButton) {
								this.startIndexingButton.setDisabled(true);
								this.startIndexingButton.setButtonText(
									"Rebuilding...",
								);
							}
							button.setDisabled(true);
							button.setButtonText("Rebuilding...");

							try {
								await this.plugin.triggerInitialIndexing(true); // Force rebuild
								new Notice("Index rebuilt successfully!");
							} catch (error) {
								devLog.error("Index rebuild failed:", error);
								new Notice(
									"Failed to rebuild index. Check console for details.",
								);
							} finally {
								if (this.startIndexingButton) {
									this.startIndexingButton.setDisabled(false);
									this.startIndexingButton.setButtonText(
										"Start full vault indexing",
									);
								}
								button.setDisabled(false);
								button.setButtonText("Rebuild index");
							}
						});
					if (this.plugin.isIndexing) {
						button.setDisabled(true);
						button.setButtonText("Rebuilding...");
					}
				});
		}

		// --- Inject CSS --- <<< CALL INJECTOR FUNCTION
		// Settings styles are now compiled into styles.css
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
			(a.description || a.id).localeCompare(b.description || b.id),
		);

		entries.forEach((entry) => {
			const settingItem = new Setting(containerEl)
				.setName(entry.description || `(ID: ${entry.id})`) // Show ID if no description
				.setDesc(
					`Trigger: ${entry.slashCommandTrigger || "None"} | Type: ${
						entry.contentType
					} | v${entry.version}`,
				)
				.setClass("hydrate-registry-item") // Custom class for item styling

				// Edit Button
				.addButton((button) =>
					button
						.setIcon("pencil") // Use Obsidian's pencil icon
						.setTooltip("Edit format entry") // Updated tooltip
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
													: e,
											);
									this.plugin.saveSettings();
									this.renderFormatRegistryList(containerEl); // Use specific renderer
									new Notice(
										`Updated format entry: ${
											updatedEntry.description ||
											updatedEntry.id
										}`,
									);
								},
							);
							modal.open();
						}),
				)
				// Delete Button
				.addButton((button) =>
					button
						.setIcon("trash") // Use Obsidian's trash icon
						.setTooltip("Delete format entry") // Updated tooltip
						.setWarning() // Use Obsidian's warning style for delete
						.onClick(async () => {
							// Simple confirmation using window.confirm (consider a custom modal for better UX)
							if (
								confirm(
									`Are you sure you want to delete "${
										entry.description || entry.id
									}"?`,
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
									}`,
								);
							}
						}),
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
			(a.description || a.id).localeCompare(b.description || b.id),
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
						.setTooltip("Edit rule")
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
													: r,
											);
									this.plugin.saveSettings();
									this.renderRulesRegistryList(containerEl); // Re-render this list
									new Notice(
										`Updated rule: ${
											updatedRule.description ||
											updatedRule.id
										}`,
									);
								},
							);
							modal.open();
						}),
				)
				// Delete Button
				.addButton((button) =>
					button
						.setIcon("trash")
						.setTooltip("Delete rule")
						.setWarning()
						.onClick(async () => {
							if (
								confirm(
									`Are you sure you want to delete the rule "${
										rule.description || rule.id
									}"?`,
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
									}`,
								);
							}
						}),
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
				"hydrate-mcp-server-controls",
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
				// Prevent double-clicks during operation
				if (toggle.disabled) return;

				const originalChecked = !toggle.checked;
				server.enabled = toggle.checked;
				await this.plugin.saveSettings();

				// Disable toggle during operation
				toggle.disabled = true;
				const label = toggleContainer.querySelector("label");
				if (label)
					label.textContent = toggle.checked
						? "Starting..."
						: "Stopping...";

				try {
					// Update the server configuration in the MCP manager
					if (
						this.plugin.mcpManager &&
						this.plugin.mcpManager.hasServer(server.id)
					) {
						await this.plugin.mcpManager.updateServerConfig(
							server.id,
							{
								enabled: server.enabled,
							},
						);
					}

					// Start or stop server based on new state
					if (this.plugin.mcpManager) {
						if (toggle.checked) {
							await this.plugin.mcpManager.startServer(server.id);
						} else {
							await this.plugin.mcpManager.stopServer(server.id);
						}
					}
				} catch (error) {
					devLog.error(
						`Failed to ${
							toggle.checked ? "start" : "stop"
						} server ${server.id}:`,
						error,
					);
					// Revert the toggle state on error
					toggle.checked = originalChecked;
					server.enabled = originalChecked;
					await this.plugin.saveSettings();

					// Update the server config in manager to match reverted state
					if (
						this.plugin.mcpManager &&
						this.plugin.mcpManager.hasServer(server.id)
					) {
						await this.plugin.mcpManager.updateServerConfig(
							server.id,
							{
								enabled: server.enabled,
							},
						);
					}
				} finally {
					// Re-enable toggle
					toggle.disabled = false;
					// Don't immediately re-render - let event listeners handle UI updates
				}
			};
			toggleContainer.createEl("label", {
				text: toggle.checked ? "Enabled" : "Disabled",
				cls: toggle.checked
					? "hydrate-mcp-enabled"
					: "hydrate-mcp-disabled",
			});

			// Action Buttons
			const actionButtons = serverControls.createDiv(
				"hydrate-mcp-actions",
			);

			// Settings Button
			const settingsButton = actionButtons.createEl("button", {
				text: "Settings",
				cls: "hydrate-mcp-action-btn",
			});
			settingsButton.onclick = () => {
				new MCPServerSettingsModal(this.app, server, (updatedServer) =>
					this.updateServerSettings(index, updatedServer),
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
			new Notice("MCP manager not available");
			return;
		}

		try {
			new Notice("Testing server connection...");
			const result =
				await this.plugin.mcpManager.testServerConnection(server);

			if (result.success) {
				new Notice(
					`✅ ${server.name}: Connected successfully! Found ${
						result.toolCount || 0
					} tools.`,
				);
			} else {
				new Notice(
					`❌ ${server.name}: Connection failed - ${result.error}`,
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
		updatedServer: MCPServerConfig,
	) {
		this.plugin.settings.mcpServers[index] = updatedServer;
		this.plugin.saveSettings();
		this.display(); // Refresh the entire display
	}

	// --- BYOK Subscription Status Methods ---
	private async loadSubscriptionStatus(statusDiv: HTMLElement) {
		try {
			const response = await this.makeApiCall(
				`${this.getBackendUrl()}/subscriptions/license/${
					this.plugin.settings.licenseKey
				}/status`,
				{},
			);

			if (!response.ok) {
				statusDiv.empty();
				statusDiv.createEl("p", {
					text: `Error loading subscription status: ${response.status}`,
					cls: "hydrate-error-message",
				});
				return;
			}

			const licenseInfo = await response.json();
			const tierName = licenseInfo.tier?.toUpperCase() || "UNKNOWN";
			const statusColor = licenseInfo.is_active ? "green" : "red";
			const statusText = licenseInfo.is_active ? "Active" : "Inactive";

			statusDiv.empty();

			// Create subscription status info container
			const infoContainer = statusDiv.createDiv({
				cls: "hydrate-subscription-status-info",
			});

			// Tier information
			const tierP = infoContainer.createEl("p");
			tierP.createEl("strong", { text: "Tier: " });
			tierP.createEl("span", {
				text: tierName,
				cls: licenseInfo.is_active
					? "hydrate-status-active"
					: "hydrate-status-inactive",
			});

			// Status information
			const statusP = infoContainer.createEl("p");
			statusP.createEl("strong", { text: "Status: " });
			statusP.createEl("span", {
				text: statusText,
				cls: licenseInfo.is_active
					? "hydrate-status-active"
					: "hydrate-status-inactive",
			});

			// Expiration information (if available)
			if (licenseInfo.expires_at) {
				const expiresP = infoContainer.createEl("p");
				expiresP.createEl("strong", { text: "Expires: " });
				expiresP.createSpan({
					text: new Date(licenseInfo.expires_at).toLocaleDateString(),
				});
			}

			// Create subscription features container
			const featuresContainer = statusDiv.createDiv({
				cls: "hydrate-subscription-features",
			});
			featuresContainer.createEl("h5", { text: "Available features:" });

			const featuresList = featuresContainer.createEl("ul");

			// Add feature list items
			featuresList.createEl("li", {
				text: "✓ Basic AI chat with your own API keys",
			});
			featuresList.createEl("li", {
				text: "✓ File operations and editing",
			});

			const mcpIcon = licenseInfo.tier === "free" ? "✗" : "✓";
			featuresList.createEl("li", {
				text: `${mcpIcon} MCP server integrations`,
			});

			const advancedIcon = licenseInfo.tier === "free" ? "✗" : "✓";
			featuresList.createEl("li", {
				text: `${advancedIcon} Advanced file operations`,
			});

			const supportIcon = licenseInfo.tier === "free" ? "✗" : "✓";
			featuresList.createEl("li", {
				text: `${supportIcon} Priority support`,
			});

			const customIcon = licenseInfo.tier === "max" ? "✓" : "✗";
			featuresList.createEl("li", {
				text: `${customIcon} Custom integrations`,
			});
		} catch (error) {
			statusDiv.empty();
			statusDiv.createEl("p", {
				text: `Error loading subscription status: ${error.message}`,
				cls: "hydrate-error-message",
			});
		}
	}

	// --- BYOK API Key Registration Methods ---
	private async loadRegistrationStatus(statusDiv: HTMLElement) {
		try {
			const response = await this.makeApiCall(
				`${this.getBackendUrl()}/subscriptions/license/${
					this.plugin.settings.licenseKey
				}/registration-quota`,
				{},
			);

			if (!response.ok) {
				statusDiv.empty();
				statusDiv.createEl("p", {
					text: `Error loading registration status: ${response.status}`,
					cls: "hydrate-error-message",
				});
				return;
			}

			const quota = await response.json();
			statusDiv.empty();

			statusDiv
				.createEl("p")
				.createEl("strong", { text: "Registration Status:" });

			const quotaList = statusDiv.createEl("ul");
			quotaList.createEl("li", {
				text: `Re-registrations used: ${quota.registration_count} / ${quota.max_reregistrations}`,
			});
			quotaList.createEl("li", {
				text: `Quota resets: ${new Date(quota.next_reset).toLocaleDateString()}`,
			});
			quotaList.createEl("li", {
				text: `Remaining: ${quota.max_reregistrations - quota.registration_count}`,
			});
		} catch (error) {
			statusDiv.empty();
			statusDiv.createEl("p", {
				text: `Error loading registration status: ${error.message}`,
				cls: "hydrate-error-message",
			});
		}
	}

	private async handleAPIKeyReregistration() {
		const modal = new (class extends Modal {
			constructor(
				app: App,
				private settingsTab: HydrateSettingTab,
			) {
				super(app);
			}

			onOpen() {
				const { contentEl } = this;
				contentEl.createEl("h2", { text: "Re-register API keys" });
				contentEl.createEl("p", {
					text: "Are you sure you want to re-register your API keys? This will revoke all previously registered keys and count against your annual quota.",
				});

				const buttonContainer = contentEl.createEl("div", {
					cls: "hydrate-modal-button-container",
				});
				buttonContainer.addClass("hydrate-button-container");

				const cancelButton = buttonContainer.createEl("button", {
					text: "Cancel",
				});
				cancelButton.onclick = () => this.close();

				new ButtonComponent(buttonContainer)
					.setButtonText("Re-register keys")
					.setCta()
					.onClick(async () => {
						await this.settingsTab.performAPIKeyReregistration();
						this.close();
					});
			}

			onClose() {
				const { contentEl } = this;
				contentEl.empty();
			}
		})(this.app, this);
		modal.open();
	}

	private async performAPIKeyReregistration() {
		try {
			const apiKeys = {
				openai: this.plugin.settings.openaiApiKey,
				anthropic: this.plugin.settings.anthropicApiKey,
				google: this.plugin.settings.googleApiKey,
			};

			// Filter out empty keys
			const validKeys = Object.fromEntries(
				Object.entries(apiKeys).filter(
					([_, value]) => value && value.trim(),
				),
			);

			if (Object.keys(validKeys).length === 0) {
				new Notice(
					"No API keys to register. Please configure your API keys first.",
				);
				return;
			}

			const response = await this.makeApiCall(
				`${this.getBackendUrl()}/subscriptions/license/reregister-api-keys`,
				{
					license_key: this.plugin.settings.licenseKey,
					api_keys: validKeys,
					reason: "User initiated re-registration from plugin settings",
				},
			);

			if (response.ok) {
				new Notice("API keys re-registered successfully!");
				// Refresh the status display
				const statusDiv = document.querySelector(
					".hydrate-registration-status",
				) as HTMLElement;
				if (statusDiv) {
					await this.loadRegistrationStatus(statusDiv);
				}
			} else {
				const error = await response.json();
				new Notice(`Error re-registering API keys: ${error.detail}`);
			}
		} catch (error) {
			new Notice(`Error re-registering API keys: ${error.message}`);
		}
	}

	private async makeApiCall(url: string, data: unknown): Promise<Response> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};

		// Add license key if available
		if (this.plugin.settings.licenseKey) {
			headers["X-License-Key"] = this.plugin.settings.licenseKey;
		}

		// Add user API keys
		if (this.plugin.settings.openaiApiKey) {
			headers["X-OpenAI-Key"] = this.plugin.settings.openaiApiKey;
		}
		if (this.plugin.settings.anthropicApiKey) {
			headers["X-Anthropic-Key"] = this.plugin.settings.anthropicApiKey;
		}
		if (this.plugin.settings.googleApiKey) {
			headers["X-Google-Key"] = this.plugin.settings.googleApiKey;
		}

		return fetch(url, {
			method: "POST",
			headers,
			body: JSON.stringify(data),
		});
	}
}
