// src/components/HydrateView/imageUtils.ts
import { App, normalizePath, TFile } from "obsidian";
import { ImageAttachment, StoredImageAttachment, ChatImage, isStoredImage } from "../../types";
import { devLog } from "../../utils/logger";

/** Supported image MIME types */
export const SUPPORTED_IMAGE_TYPES = [
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
];

/** Maximum image size in bytes (5MB) */
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

/**
 * Check if a file is a supported image type
 */
export function isSupportedImage(file: File): boolean {
	return SUPPORTED_IMAGE_TYPES.includes(file.type);
}

/**
 * Check if a file is within size limits
 */
export function isWithinSizeLimit(file: File): boolean {
	return file.size <= MAX_IMAGE_SIZE;
}

/**
 * Validate an image file
 * Returns error message if invalid, null if valid
 */
export function validateImage(file: File): string | null {
	if (!isSupportedImage(file)) {
		return `Unsupported image type: ${file.type}. Supported: PNG, JPEG, WebP, GIF`;
	}
	if (!isWithinSizeLimit(file)) {
		const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
		return `Image too large: ${sizeMB}MB. Maximum: 5MB`;
	}
	return null;
}

/**
 * Convert a File to base64-encoded ImageAttachment
 */
export function fileToImageAttachment(file: File): Promise<ImageAttachment> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			// Validate result is a string (readAsDataURL always returns string, but be safe)
			if (typeof reader.result !== "string") {
				reject(new Error("FileReader result is not a string"));
				return;
			}
			const result = reader.result;
			// Result is "data:image/png;base64,ABC123..."
			// Extract just the base64 part after the comma
			const base64Data = result.split(",")[1];
			if (!base64Data) {
				reject(new Error("Failed to extract base64 data from image"));
				return;
			}
			resolve({
				data: base64Data,
				mimeType: file.type,
				filename: file.name,
			});
		};
		reader.onerror = () => {
			reject(new Error(`Failed to read image file: ${file.name}`));
		};
		reader.readAsDataURL(file);
	});
}

/**
 * Extract image files from a DataTransfer object (drag-drop or paste)
 */
export function extractImagesFromDataTransfer(
	dataTransfer: DataTransfer
): File[] {
	const images: File[] = [];

	// Check items (preferred for paste events)
	if (dataTransfer.items) {
		for (let i = 0; i < dataTransfer.items.length; i++) {
			const item = dataTransfer.items[i];
			if (item.kind === "file" && SUPPORTED_IMAGE_TYPES.includes(item.type)) {
				const file = item.getAsFile();
				if (file) {
					images.push(file);
				}
			}
		}
	}

	// Fallback to files (for drag-drop)
	if (images.length === 0 && dataTransfer.files) {
		for (let i = 0; i < dataTransfer.files.length; i++) {
			const file = dataTransfer.files[i];
			if (SUPPORTED_IMAGE_TYPES.includes(file.type)) {
				images.push(file);
			}
		}
	}

	return images;
}

/**
 * Process multiple image files and return valid ImageAttachments
 * Returns array of attachments and array of error messages
 */
export async function processImageFiles(
	files: File[]
): Promise<{ attachments: ImageAttachment[]; errors: string[] }> {
	const attachments: ImageAttachment[] = [];
	const errors: string[] = [];

	for (const file of files) {
		const validationError = validateImage(file);
		if (validationError) {
			errors.push(validationError);
			continue;
		}

		try {
			const attachment = await fileToImageAttachment(file);
			attachments.push(attachment);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error";
			errors.push(`Failed to process ${file.name}: ${message}`);
			devLog.error("Image processing error:", error);
		}
	}

	return { attachments, errors };
}

// --- Vault Storage Functions ---

/** Folder path for storing chat images (not hidden - Obsidian can't embed from dot folders) */
export const IMAGES_FOLDER = "hydrate-chats/images";

/**
 * Get file extension from MIME type
 */
function getExtensionFromMimeType(mimeType: string): string {
	const extensions: Record<string, string> = {
		"image/png": "png",
		"image/jpeg": "jpg",
		"image/webp": "webp",
		"image/gif": "gif",
	};
	return extensions[mimeType] || "png";
}

/**
 * Ensure the images folder exists in the vault
 */
export async function ensureImagesFolderExists(app: App): Promise<void> {
	const folderPath = normalizePath(IMAGES_FOLDER);
	// Use adapter.exists() instead of getAbstractFileByPath to avoid vault index issues
	const exists = await app.vault.adapter.exists(folderPath);
	if (!exists) {
		await app.vault.createFolder(folderPath);
		devLog.debug(`Created images folder: ${folderPath}`);
	}
}

/**
 * Save a base64 ImageAttachment to vault, returning a StoredImageAttachment
 */
export async function saveImageToVault(
	app: App,
	image: ImageAttachment,
	index: number
): Promise<StoredImageAttachment> {
	await ensureImagesFolderExists(app);

	const ext = getExtensionFromMimeType(image.mimeType);
	const timestamp = Date.now();
	const filename = `img_${timestamp}_${index}.${ext}`;
	const vaultPath = normalizePath(`${IMAGES_FOLDER}/${filename}`);

	// Convert base64 to binary
	const binaryString = atob(image.data);
	const binaryData = new ArrayBuffer(binaryString.length);
	const view = new Uint8Array(binaryData);
	for (let i = 0; i < binaryString.length; i++) {
		view[i] = binaryString.charCodeAt(i);
	}

	// Create file in vault
	await app.vault.createBinary(vaultPath, binaryData);
	devLog.debug(`Saved image to vault: ${vaultPath}`);

	return {
		vaultPath,
		mimeType: image.mimeType,
		filename: image.filename,
	};
}

/**
 * Load an image from vault path as a data URL for display
 */
export async function loadImageFromVault(
	app: App,
	storedImage: StoredImageAttachment
): Promise<string> {
	// Use adapter.readBinary() directly instead of vault.readBinary()
	// This works even if the vault index hasn't updated yet after createBinary()
	const normalizedPath = normalizePath(storedImage.vaultPath);

	// Check if file exists using adapter
	const exists = await app.vault.adapter.exists(normalizedPath);
	if (!exists) {
		throw new Error(`Image file not found: ${storedImage.vaultPath}`);
	}

	const binaryData = await app.vault.adapter.readBinary(normalizedPath);
	const base64 = btoa(
		new Uint8Array(binaryData).reduce(
			(data, byte) => data + String.fromCharCode(byte),
			""
		)
	);

	return `data:${storedImage.mimeType};base64,${base64}`;
}

/**
 * Get data URL for any ChatImage (handles both base64 and vault-stored)
 */
export async function getImageDataUrl(
	app: App,
	image: ChatImage
): Promise<string> {
	if (isStoredImage(image)) {
		return loadImageFromVault(app, image);
	} else {
		return `data:${image.mimeType};base64,${image.data}`;
	}
}
