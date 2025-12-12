import { Setting, TextComponent } from "obsidian";

/**
 * Configuration for creating an API key setting with password visibility toggle
 */
export interface ApiKeySettingConfig {
	containerEl: HTMLElement;
	name: string;
	desc: string;
	value: string;
	onChange: (value: string) => Promise<void>;
	placeholder?: string;
}

/**
 * Creates a Setting with a password input and visibility toggle button.
 * Reduces code duplication for API key inputs in settings.
 */
export function createApiKeySetting(config: ApiKeySettingConfig): Setting {
	const { containerEl, name, desc, value, onChange, placeholder = "API key" } = config;

	return new Setting(containerEl)
		.setName(name)
		.setDesc(desc)
		.addText((text) => {
			addPasswordToggle(text, value, onChange, placeholder);
		});
}

/**
 * Adds password field behavior with visibility toggle to a TextComponent.
 * Can be used standalone if you need more control over the Setting.
 */
export function addPasswordToggle(
	text: TextComponent,
	value: string,
	onChange: (value: string) => Promise<void>,
	placeholder = "API key",
): void {
	let visible = false;

	text.setPlaceholder(placeholder)
		.setValue(value)
		.onChange(async (newValue) => {
			await onChange(newValue.trim());
		});

	text.inputEl.type = "password";

	// Add eye icon button for visibility toggle
	const eyeBtn = document.createElement("button");
	eyeBtn.type = "button";
	eyeBtn.addClass("hydrate-eye-button");
	eyeBtn.appendChild(document.createTextNode("\u{1F441}"));
	eyeBtn.onclick = (e) => {
		e.preventDefault();
		visible = !visible;
		text.inputEl.type = visible ? "text" : "password";
	};

	text.inputEl.parentElement?.appendChild(eyeBtn);
}
