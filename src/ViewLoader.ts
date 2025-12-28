// src/ViewLoader.ts
import { App, TFile, TFolder } from "obsidian";
import { transform } from "sucrase";
import * as React from "react";
import { devLog } from "./utils/logger";
import { registerReactView } from "./main";
import { ReactViewProps } from "./types";

// Views directory relative to vault root
const VIEWS_DIR = ".obsidian/plugins/hydrate/views";

export class ViewLoader {
	private app: App;
	private loadedViews: Map<string, React.ComponentType<ReactViewProps>> =
		new Map();

	constructor(app: App) {
		this.app = app;
	}

	/**
	 * Get the views directory path
	 */
	getViewsDir(): string {
		return VIEWS_DIR;
	}

	/**
	 * Ensure the views directory exists
	 */
	async ensureViewsDir(): Promise<void> {
		const adapter = this.app.vault.adapter;
		const exists = await adapter.exists(VIEWS_DIR);
		if (!exists) {
			await adapter.mkdir(VIEWS_DIR);
			devLog.debug("ViewLoader: Created views directory");
		}
	}

	/**
	 * Load all .jsx files from the views directory
	 */
	async loadAllViews(): Promise<void> {
		await this.ensureViewsDir();

		const adapter = this.app.vault.adapter;
		const listing = await adapter.list(VIEWS_DIR);

		for (const filePath of listing.files) {
			if (filePath.endsWith(".jsx")) {
				await this.loadView(filePath);
			}
		}

		devLog.debug(
			`ViewLoader: Loaded ${this.loadedViews.size} custom views`
		);
	}

	/**
	 * Load a single view from a .jsx file
	 */
	async loadView(filePath: string): Promise<boolean> {
		const viewName = this.getViewNameFromPath(filePath);

		try {
			const adapter = this.app.vault.adapter;
			const code = await adapter.read(filePath);

			const component = this.compileAndEvaluate(code, viewName);
			if (component) {
				this.loadedViews.set(viewName, component);
				registerReactView(viewName, component);
				devLog.debug(`ViewLoader: Loaded view "${viewName}"`);
				return true;
			}
		} catch (error) {
			devLog.error(
				`ViewLoader: Failed to load view "${viewName}":`,
				error
			);
		}

		return false;
	}

	/**
	 * Reload a specific view (for hot reloading)
	 */
	async reloadView(filePath: string): Promise<boolean> {
		return this.loadView(filePath);
	}

	/**
	 * Check if a view exists
	 */
	hasView(viewName: string): boolean {
		return this.loadedViews.has(viewName);
	}

	/**
	 * Get list of loaded view names
	 */
	getLoadedViewNames(): string[] {
		return Array.from(this.loadedViews.keys());
	}

	/**
	 * Extract view name from file path
	 * e.g., ".obsidian/plugins/hydrate/views/recipe-cards.jsx" -> "recipe-cards"
	 */
	private getViewNameFromPath(filePath: string): string {
		const fileName = filePath.split("/").pop() || "";
		return fileName.replace(".jsx", "");
	}

	/**
	 * Compile JSX code and evaluate it to get a React component
	 */
	private compileAndEvaluate(
		jsxCode: string,
		viewName: string
	): React.ComponentType<ReactViewProps> | null {
		try {
			// Transform JSX to plain JavaScript
			const result = transform(jsxCode, {
				transforms: ["jsx", "imports"],
				jsxRuntime: "classic",
				production: true,
			});

			// Create a module-like environment for the component
			const exports: { default?: React.ComponentType<ReactViewProps> } =
				{};
			const require = (moduleName: string): unknown => {
				if (moduleName === "react") return React;
				throw new Error(`Unknown module: ${moduleName}`);
			};

			// Evaluate the transformed code
			// The component should export default
			const moduleFunction = new Function(
				"exports",
				"require",
				"React",
				result.code
			);
			moduleFunction(exports, require, React);

			if (typeof exports.default === "function") {
				return exports.default;
			}

			devLog.error(
				`ViewLoader: View "${viewName}" does not export a default component`
			);
			return null;
		} catch (error) {
			devLog.error(
				`ViewLoader: Failed to compile view "${viewName}":`,
				error
			);
			return null;
		}
	}

	/**
	 * Save a new view to the views directory
	 */
	async saveView(viewName: string, code: string): Promise<boolean> {
		await this.ensureViewsDir();

		const filePath = `${VIEWS_DIR}/${viewName}.jsx`;

		try {
			const adapter = this.app.vault.adapter;
			await adapter.write(filePath, code);
			devLog.debug(`ViewLoader: Saved view "${viewName}"`);

			// Load the newly saved view
			await this.loadView(filePath);
			return true;
		} catch (error) {
			devLog.error(
				`ViewLoader: Failed to save view "${viewName}":`,
				error
			);
			return false;
		}
	}

	/**
	 * Delete a view
	 */
	async deleteView(viewName: string): Promise<boolean> {
		const filePath = `${VIEWS_DIR}/${viewName}.jsx`;

		try {
			const adapter = this.app.vault.adapter;
			const exists = await adapter.exists(filePath);
			if (exists) {
				await adapter.remove(filePath);
				this.loadedViews.delete(viewName);
				devLog.debug(`ViewLoader: Deleted view "${viewName}"`);
				return true;
			}
		} catch (error) {
			devLog.error(
				`ViewLoader: Failed to delete view "${viewName}":`,
				error
			);
		}

		return false;
	}

	/**
	 * Get the file path for a view
	 */
	getViewFilePath(viewName: string): string {
		return `${VIEWS_DIR}/${viewName}.jsx`;
	}
}
