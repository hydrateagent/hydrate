// src/components/HydrateView/imageUtils.ts
import { ImageAttachment } from "../../types";
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
