import { App, Modal, Setting, Notice, ButtonComponent } from "obsidian";
import { MCPServerConfig } from "../mcp/MCPServerConfig";

export class MCPServerSettingsModal extends Modal {
	private server: MCPServerConfig;
	private onSave: (server: MCPServerConfig) => void;

	constructor(
		app: App,
		server: MCPServerConfig,
		onSave: (server: MCPServerConfig) => void,
	) {
		super(app);
		this.server = { ...server }; // Clone to avoid modifying original
		this.onSave = onSave;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: `${this.server.name}` });

		contentEl.createEl("p", {
			text: "Configure advanced settings, metadata, and health checks for this MCP server.",
			cls: "setting-item-description",
		});

		// Server Settings Section
		new Setting(contentEl).setName("Servers").setHeading();

		new Setting(contentEl)
			.setName("Auto restart")
			.setDesc("Automatically restart the server if it crashes")
			.addToggle((toggle) => {
				toggle
					.setValue(this.server.autoRestart !== false)
					.onChange((value) => {
						this.server.autoRestart = value;
					});
			});

		new Setting(contentEl)
			.setName("Max restarts")
			.setDesc("Maximum number of restart attempts")
			.addText((text) => {
				text.setPlaceholder("3")
					.setValue(String(this.server.maxRestarts || 3))
					.onChange((value) => {
						const num = parseInt(value);
						if (!isNaN(num) && num >= 0) {
							this.server.maxRestarts = num;
						}
					});
			});

		new Setting(contentEl)
			.setName("Startup timeout (ms)")
			.setDesc("Timeout for server startup")
			.addText((text) => {
				text.setPlaceholder("10000")
					.setValue(String(this.server.startupTimeout || 10000))
					.onChange((value) => {
						const num = parseInt(value);
						if (!isNaN(num) && num > 0) {
							this.server.startupTimeout = num;
						}
					});
			});

		new Setting(contentEl)
			.setName("Shutdown timeout (ms)")
			.setDesc("Timeout for server shutdown")
			.addText((text) => {
				text.setPlaceholder("5000")
					.setValue(String(this.server.shutdownTimeout || 5000))
					.onChange((value) => {
						const num = parseInt(value);
						if (!isNaN(num) && num > 0) {
							this.server.shutdownTimeout = num;
						}
					});
			});

		// Health Check Configuration Section
		new Setting(contentEl).setName("Health check").setHeading();

		new Setting(contentEl)
			.setName("Health check interval (ms)")
			.setDesc("Interval between health checks")
			.addText((text) => {
				text.setPlaceholder("30000")
					.setValue(
						String(this.server.healthCheck?.interval || 30000),
					)
					.onChange((value) => {
						const num = parseInt(value);
						if (!isNaN(num) && num > 0) {
							if (!this.server.healthCheck) {
								this.server.healthCheck = {
									interval: 30000,
									timeout: 5000,
									failureThreshold: 3,
								};
							}
							this.server.healthCheck.interval = num;
						}
					});
			});

		new Setting(contentEl)
			.setName("Health check timeout (ms)")
			.setDesc("Timeout for individual health check requests")
			.addText((text) => {
				text.setPlaceholder("5000")
					.setValue(String(this.server.healthCheck?.timeout || 5000))
					.onChange((value) => {
						const num = parseInt(value);
						if (!isNaN(num) && num > 0) {
							if (!this.server.healthCheck) {
								this.server.healthCheck = {
									interval: 30000,
									timeout: 5000,
									failureThreshold: 3,
								};
							}
							this.server.healthCheck.timeout = num;
						}
					});
			});

		new Setting(contentEl)
			.setName("Failure threshold")
			.setDesc("Number of failed checks before marking as unhealthy")
			.addText((text) => {
				text.setPlaceholder("3")
					.setValue(
						String(this.server.healthCheck?.failureThreshold || 3),
					)
					.onChange((value) => {
						const num = parseInt(value);
						if (!isNaN(num) && num > 0) {
							if (!this.server.healthCheck) {
								this.server.healthCheck = {
									interval: 30000,
									timeout: 5000,
									failureThreshold: 3,
								};
							}
							this.server.healthCheck.failureThreshold = num;
						}
					});
			});

		// Optional Metadata Section
		new Setting(contentEl).setName("Optional metadata").setHeading();

		new Setting(contentEl)
			.setName("Description")
			.setDesc("Description of what this server provides")
			.addText((text) => {
				text.setPlaceholder("Provides file system tools...")
					.setValue(this.server.description || "")
					.onChange((value) => {
						this.server.description = value.trim() || undefined;
					});
			});

		new Setting(contentEl)
			.setName("Tags")
			.setDesc("Comma-separated tags for categorizing this server")
			.addText((text) => {
				text.setPlaceholder("filesystem, development, tools")
					.setValue((this.server.tags || []).join(", "))
					.onChange((value) => {
						this.server.tags = value.trim()
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
				text.setPlaceholder("1.0.0")
					.setValue(this.server.version || "")
					.onChange((value) => {
						this.server.version = value.trim() || undefined;
					});
			});

		new Setting(contentEl)
			.setName("Working directory")
			.setDesc("Working directory for the server process (optional)")
			.addText((text) => {
				text.setPlaceholder("/path/to/server")
					.setValue(this.server.cwd || "")
					.onChange((value) => {
						this.server.cwd = value.trim() || undefined;
					});
			});

		// Buttons
		const buttonContainer = contentEl.createDiv({
			cls: "hydrate-modal-button-container",
		});

		new ButtonComponent(buttonContainer)
			.setButtonText("Save settings")
			.setCta()
			.onClick(() => {
				this.onSave(this.server);
				new Notice(`Updated settings for ${this.server.name}`);
				this.close();
			});

		const cancelButton = buttonContainer.createEl("button", {
			text: "Cancel",
		});
		cancelButton.onclick = () => this.close();
	}
}
