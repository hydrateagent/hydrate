# Image Input Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable users to drag-drop and paste images into the chat, sending them to vision-capable LLMs.

**Architecture:** Images are captured on the frontend, converted to base64, sent to the backend as a separate `images` array in the request, and converted to multimodal `HumanMessage` content for LangChain. All current models (GPT-4o, Claude, Gemini) support vision natively.

**Tech Stack:** TypeScript (Obsidian plugin), Python (FastAPI backend), LangChain multimodal messages

---

## Task 1: Extend Types for Image Support

**Files:**
- Modify: `src/types.ts:56-60`

**Step 1: Add ImageAttachment interface**

Add after line 51 (after Patch type):

```typescript
// --- Image Attachment Type ---

/** Represents an attached image for chat messages */
export interface ImageAttachment {
	data: string;      // base64-encoded image data (without data URI prefix)
	mimeType: string;  // e.g., "image/png", "image/jpeg", "image/webp", "image/gif"
	filename?: string; // optional original filename
}

// --- END Image Attachment Type ---
```

**Step 2: Extend ChatTurn interface**

Change ChatTurn (lines 56-60) from:
```typescript
export interface ChatTurn {
	role: "user" | "agent";
	content: string;
	timestamp: string;
}
```

To:
```typescript
export interface ChatTurn {
	role: "user" | "agent";
	content: string;
	images?: ImageAttachment[]; // optional images for this turn
	timestamp: string;
}
```

**Step 3: Verify TypeScript compiles**

Run: `cd /Users/jamie/Code/hydrate-vault/.obsidian/plugins/hydrate && npm run build`
Expected: Build succeeds with no type errors

**Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat: add ImageAttachment type and extend ChatTurn for images"
```

---

## Task 2: Add Image State to HydrateView

**Files:**
- Modify: `src/components/HydrateView/hydrateView.ts:85-120`

**Step 1: Import ImageAttachment type**

Change line 17 from:
```typescript
import { RegistryEntry, Patch, ChatHistory, ChatTurn } from "../../types";
```

To:
```typescript
import { RegistryEntry, Patch, ChatHistory, ChatTurn, ImageAttachment } from "../../types";
```

**Step 2: Add attachedImages property to HydrateView class**

After line 90 (`public attachedFiles: string[] = [];`), add:

```typescript
	public attachedImages: ImageAttachment[] = [];
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/components/HydrateView/hydrateView.ts
git commit -m "feat: add attachedImages state to HydrateView"
```

---

## Task 3: Create Image Utility Functions

**Files:**
- Create: `src/components/HydrateView/imageUtils.ts`

**Step 1: Create the imageUtils.ts file**

```typescript
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
			const result = reader.result as string;
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
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/components/HydrateView/imageUtils.ts
git commit -m "feat: add image utility functions for validation and base64 conversion"
```

---

## Task 4: Handle Image Drag-Drop

**Files:**
- Modify: `src/components/HydrateView/eventHandlers.ts:50-180`

**Step 1: Add imports**

Add to the imports at the top of the file (after line 16):

```typescript
import {
	extractImagesFromDataTransfer,
	processImageFiles,
} from "./imageUtils";
```

**Step 2: Modify handleDrop to detect images**

Replace the beginning of `handleDrop` function (lines 50-68) with:

```typescript
export const handleDrop = async (view: HydrateView, event: DragEvent): Promise<void> => {
	event.preventDefault();
	event.stopPropagation();
	const containerEl = view.containerEl;
	const inputSection = containerEl.querySelector(".hydrate-input-section");
	if (!inputSection) return;
	inputSection.classList.remove("hydrate-drag-over");

	if (!event.dataTransfer) {
		devLog.warn("Hydrate drop: No dataTransfer available.");
		return;
	}

	// Check for image files first
	const imageFiles = extractImagesFromDataTransfer(event.dataTransfer);
	if (imageFiles.length > 0) {
		await handleImageDrop(view, imageFiles);
		return;
	}

	// Fall through to existing file path handling
	let pathData = "";
	if (event.dataTransfer.types.includes("text/uri-list")) {
		pathData = event.dataTransfer.getData("text/uri-list");
	} else if (event.dataTransfer.types.includes("text/plain")) {
		pathData = event.dataTransfer.getData("text/plain");
	}
```

**Step 3: Add handleImageDrop helper function**

Add this new function before the `handleDrop` function (around line 46):

```typescript
/**
 * Handles image files dropped into the input area.
 */
async function handleImageDrop(view: HydrateView, files: File[]): Promise<void> {
	const { attachments, errors } = await processImageFiles(files);

	// Show errors if any
	if (errors.length > 0) {
		errors.forEach((error) => {
			addMessageToChat(view, "system", error, true);
		});
	}

	// Add valid images to state
	if (attachments.length > 0) {
		view.attachedImages.push(...attachments);
		renderImagePreviews(view);
		devLog.debug(`Added ${attachments.length} image(s) to attachedImages`);
	}
}
```

**Step 4: Add renderImagePreviews placeholder**

Add after handleImageDrop:

```typescript
/**
 * Renders image preview thumbnails in the input area.
 * TODO: Implement in domUtils.ts
 */
function renderImagePreviews(view: HydrateView): void {
	// Placeholder - will be implemented in Task 6
	devLog.debug(`renderImagePreviews: ${view.attachedImages.length} images`);
}
```

**Step 5: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 6: Commit**

```bash
git add src/components/HydrateView/eventHandlers.ts
git commit -m "feat: handle image drag-drop in chat input"
```

---

## Task 5: Handle Image Paste

**Files:**
- Modify: `src/components/HydrateView/eventHandlers.ts`
- Modify: `src/components/HydrateView/hydrateView.ts`

**Step 1: Create handlePaste function in eventHandlers.ts**

Add this function after `handleImageDrop`:

```typescript
/**
 * Handles paste events to capture images from clipboard.
 */
export const handlePaste = async (view: HydrateView, event: ClipboardEvent): Promise<void> => {
	if (!event.clipboardData) return;

	const imageFiles = extractImagesFromDataTransfer(event.clipboardData);
	if (imageFiles.length === 0) return;

	// Prevent default paste behavior for images
	event.preventDefault();

	const { attachments, errors } = await processImageFiles(imageFiles);

	// Show errors if any
	if (errors.length > 0) {
		errors.forEach((error) => {
			addMessageToChat(view, "system", error, true);
		});
	}

	// Add valid images to state
	if (attachments.length > 0) {
		view.attachedImages.push(...attachments);
		renderImagePreviews(view);
		devLog.debug(`Pasted ${attachments.length} image(s)`);
	}
};
```

**Step 2: Export handlePaste in eventHandlers.ts**

The function is already exported (uses `export const`).

**Step 3: Add paste event listener in hydrateView.ts**

Find where `this.textInput` event listeners are added (search for `this.textInput.addEventListener`). Add after the existing listeners:

```typescript
		// Handle paste for images
		this.textInput.addEventListener("paste", (e: ClipboardEvent) => {
			handlePaste(this, e);
		});
```

**Step 4: Import handlePaste in hydrateView.ts**

Update the import from eventHandlers (around line 31-38) to include handlePaste:

```typescript
import {
	handleClear,
	handleDrop,
	handlePaste,
	handleSend,
	handleStop,
	handleInputChange,
	handleInputKeydown,
} from "./eventHandlers";
```

**Step 5: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 6: Commit**

```bash
git add src/components/HydrateView/eventHandlers.ts src/components/HydrateView/hydrateView.ts
git commit -m "feat: handle image paste from clipboard"
```

---

## Task 6: Display Image Previews in Input Area

**Files:**
- Modify: `src/components/HydrateView/domUtils.ts`
- Modify: `src/components/HydrateView/eventHandlers.ts`

**Step 1: Add renderImagePreviews to domUtils.ts**

Add this function after the `renderFilePills` function:

```typescript
/**
 * Renders image preview thumbnails in the input area.
 */
export const renderImagePreviews = (view: HydrateView): void => {
	const containerEl = view.containerEl;

	// Find or create image previews container
	let imagePreviews = containerEl.querySelector(".hydrate-image-previews") as HTMLDivElement;
	if (!imagePreviews) {
		const inputSection = containerEl.querySelector(".hydrate-input-section");
		if (!inputSection) return;

		imagePreviews = document.createElement("div");
		imagePreviews.className = "hydrate-image-previews";
		imagePreviews.style.cssText = `
			display: flex;
			flex-wrap: wrap;
			gap: 8px;
			padding: 8px;
			border-bottom: 1px solid var(--background-modifier-border);
		`;
		inputSection.insertBefore(imagePreviews, inputSection.firstChild);
	}

	// Clear existing previews
	imagePreviews.innerHTML = "";

	// Hide if no images
	if (view.attachedImages.length === 0) {
		imagePreviews.style.display = "none";
		return;
	}

	imagePreviews.style.display = "flex";

	// Create preview for each image
	view.attachedImages.forEach((img, index) => {
		const preview = document.createElement("div");
		preview.className = "hydrate-image-preview";
		preview.style.cssText = `
			position: relative;
			width: 60px;
			height: 60px;
			border-radius: 4px;
			overflow: hidden;
			border: 1px solid var(--background-modifier-border);
		`;

		const imgEl = document.createElement("img");
		imgEl.src = `data:${img.mimeType};base64,${img.data}`;
		imgEl.style.cssText = `
			width: 100%;
			height: 100%;
			object-fit: cover;
		`;
		imgEl.alt = img.filename || `Image ${index + 1}`;

		const removeBtn = document.createElement("button");
		removeBtn.className = "hydrate-image-remove";
		removeBtn.innerHTML = "×";
		removeBtn.style.cssText = `
			position: absolute;
			top: 2px;
			right: 2px;
			width: 18px;
			height: 18px;
			border-radius: 50%;
			border: none;
			background: var(--background-modifier-error);
			color: white;
			cursor: pointer;
			font-size: 12px;
			line-height: 1;
			display: flex;
			align-items: center;
			justify-content: center;
		`;
		removeBtn.onclick = (e) => {
			e.stopPropagation();
			view.attachedImages.splice(index, 1);
			renderImagePreviews(view);
		};

		preview.appendChild(imgEl);
		preview.appendChild(removeBtn);
		imagePreviews.appendChild(preview);
	});
};
```

**Step 2: Export renderImagePreviews**

Add to the exports in domUtils.ts (if not using named exports, add to export list).

**Step 3: Update eventHandlers.ts to use the real renderImagePreviews**

Update the import at the top of eventHandlers.ts:

```typescript
import {
	addMessageToChat,
	renderFilePills as renderDomFilePills,
	renderImagePreviews as renderDomImagePreviews,
	setLoadingState as setDomLoadingState,
	setSuggestions as setDomSuggestions,
	setTextContent as setDomTextContent,
} from "./domUtils";
```

Replace the placeholder `renderImagePreviews` function with:

```typescript
function renderImagePreviews(view: HydrateView): void {
	renderDomImagePreviews(view);
}
```

**Step 4: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 5: Manual test**

- Drag an image into the chat input
- Should see a 60x60 thumbnail preview
- Click X to remove it

**Step 6: Commit**

```bash
git add src/components/HydrateView/domUtils.ts src/components/HydrateView/eventHandlers.ts
git commit -m "feat: display image preview thumbnails with remove button"
```

---

## Task 7: Clear Images on Send and Clear

**Files:**
- Modify: `src/components/HydrateView/eventHandlers.ts`

**Step 1: Clear images in handleClear**

In `handleClear` function (around line 23-45), add after `view.attachedFiles = [];`:

```typescript
	view.attachedImages = [];
```

And add after `renderDomFilePills(view);`:

```typescript
	renderImagePreviews(view);
```

**Step 2: Clear images after send in handleSend**

In `handleSend` function, in the `finally` block (around line 483-489), add:

```typescript
		view.attachedImages = [];
		renderImagePreviews(view);
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/components/HydrateView/eventHandlers.ts
git commit -m "feat: clear attached images on send and clear"
```

---

## Task 8: Send Images to Backend

**Files:**
- Modify: `src/components/HydrateView/eventHandlers.ts:456-466`

**Step 1: Update payload type and construction**

Change the payload construction (around lines 456-466) from:

```typescript
	const payload: {
		message: string;
		conversation_id: string | null;
		model: string;
		mcp_tools: MCPToolSchemaWithMetadata[];
	} = {
		message: combinedPayload,
		conversation_id: view.conversationId,
		model: view.plugin.getSelectedModel(),
		mcp_tools: mcpTools,
	};
```

To:

```typescript
	const payload: {
		message: string;
		conversation_id: string | null;
		model: string;
		mcp_tools: MCPToolSchemaWithMetadata[];
		images?: { data: string; mime_type: string }[];
	} = {
		message: combinedPayload,
		conversation_id: view.conversationId,
		model: view.plugin.getSelectedModel(),
		mcp_tools: mcpTools,
	};

	// Add images if any are attached
	if (view.attachedImages.length > 0) {
		payload.images = view.attachedImages.map((img) => ({
			data: img.data,
			mime_type: img.mimeType,
		}));
	}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/components/HydrateView/eventHandlers.ts
git commit -m "feat: include images in chat request payload"
```

---

## Task 9: Backend - Extend ChatRequest Model

**Files:**
- Modify: `/Users/jamie/Code/hydrate-vault/src/main.py:131-152`

**Step 1: Add ImageContent model**

Add after line 130 (after BaseMessageModel):

```python
class ImageContent(BaseModel):
    data: str        # base64-encoded image data
    mime_type: str   # e.g., "image/png"


```

**Step 2: Extend ChatRequest**

Change ChatRequest (lines 146-152) from:

```python
class ChatRequest(BaseModel):
    message: str
    conversation_id: Optional[str] = None
    model: Optional[ModelName] = None
    mcp_tools: Optional[List[Dict[str, Any]]] = None
    license_key: Optional[str] = None
    user_api_keys: Dict[str, str] = {}
```

To:

```python
class ChatRequest(BaseModel):
    message: str
    conversation_id: Optional[str] = None
    model: Optional[ModelName] = None
    mcp_tools: Optional[List[Dict[str, Any]]] = None
    license_key: Optional[str] = None
    user_api_keys: Dict[str, str] = {}
    images: Optional[List[ImageContent]] = None  # Optional images for vision models
```

**Step 3: Verify Python syntax**

Run: `cd /Users/jamie/Code/hydrate-vault && source venv/bin/activate && python -m py_compile src/main.py`
Expected: No output (success)

**Step 4: Commit**

```bash
git add src/main.py
git commit -m "feat: add images field to ChatRequest model"
```

---

## Task 10: Backend - Pass Images to Agent

**Files:**
- Modify: `/Users/jamie/Code/hydrate-vault/src/main.py:458-471`

**Step 1: Extract images and pass to run_agent**

Find the `run_agent` call in the `/chat` endpoint (around line 460). Change from:

```python
        agent_response_data = await run_agent(
            agent_executor=agent_executor,
            conversation_id=convo_id,
            current_state=current_state,
            user_input=request.message,
            tool_results=None,
            model_name_override=request.model,
            stop_event=stop_event,
            user_id=auth_context.get("user_id"),
            mcp_tools_data=filtered_mcp_tools,
            user_api_keys=user_api_keys,
        )
```

To:

```python
        # Convert images to dict format for agent
        images_for_agent = None
        if request.images:
            images_for_agent = [
                {"data": img.data, "mime_type": img.mime_type}
                for img in request.images
            ]

        agent_response_data = await run_agent(
            agent_executor=agent_executor,
            conversation_id=convo_id,
            current_state=current_state,
            user_input=request.message,
            tool_results=None,
            model_name_override=request.model,
            stop_event=stop_event,
            user_id=auth_context.get("user_id"),
            mcp_tools_data=filtered_mcp_tools,
            user_api_keys=user_api_keys,
            images=images_for_agent,
        )
```

**Step 2: Verify Python syntax**

Run: `python -m py_compile src/main.py`
Expected: No output (success) - Note: will fail until agent.py is updated

**Step 3: Commit**

```bash
git add src/main.py
git commit -m "feat: pass images to run_agent in chat endpoint"
```

---

## Task 11: Backend - Update run_agent Signature

**Files:**
- Modify: `/Users/jamie/Code/hydrate-vault/src/agent.py:545-612`

**Step 1: Add images parameter to run_agent**

Find `async def run_agent` (around line 545). Change the signature from:

```python
async def run_agent(
    agent_executor,
    conversation_id: str,
    current_state: AgentState,
    user_input: str | None,
    tool_results: List[Dict[str, Any]] | None,
    model_name_override: ModelName | None,
    stop_event: asyncio.Event,
    user_id: str | None = None,
    mcp_tools_data: List[Dict[str, Any]] | None = None,
    user_api_keys: Dict[str, str] | None = None,
):
```

To:

```python
async def run_agent(
    agent_executor,
    conversation_id: str,
    current_state: AgentState,
    user_input: str | None,
    tool_results: List[Dict[str, Any]] | None,
    model_name_override: ModelName | None,
    stop_event: asyncio.Event,
    user_id: str | None = None,
    mcp_tools_data: List[Dict[str, Any]] | None = None,
    user_api_keys: Dict[str, str] | None = None,
    images: List[Dict[str, str]] | None = None,
):
```

**Step 2: Build multimodal message when images present**

Find where HumanMessage is created with user_input (around lines 604-612). Change from:

```python
    elif user_input:
        # If it's a new chat message, start with current state messages and add HumanMessage
        print("--- Processing new user message with history for LangGraph invoke ---")
        messages_for_invoke.extend(
            current_state["messages"]
        )
        messages_for_invoke.append(
            HumanMessage(content=user_input)
        )
```

To:

```python
    elif user_input:
        # If it's a new chat message, start with current state messages and add HumanMessage
        print("--- Processing new user message with history for LangGraph invoke ---")
        messages_for_invoke.extend(
            current_state["messages"]
        )

        # Build message content - multimodal if images present
        if images and len(images) > 0:
            content = [{"type": "text", "text": user_input}]
            for img in images:
                content.append({
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:{img['mime_type']};base64,{img['data']}"
                    }
                })
            messages_for_invoke.append(HumanMessage(content=content))
            print(f"--- Added multimodal message with {len(images)} image(s) ---")
        else:
            messages_for_invoke.append(HumanMessage(content=user_input))
```

**Step 3: Verify Python syntax**

Run: `python -m py_compile src/agent.py`
Expected: No output (success)

**Step 4: Commit**

```bash
git add src/agent.py
git commit -m "feat: support multimodal messages with images in run_agent"
```

---

## Task 12: Display Images in Chat History

**Files:**
- Modify: `src/components/HydrateView/domUtils.ts`

**Step 1: Update addMessageToChat to handle images**

Find the `addMessageToChat` function. Add an optional `images` parameter and render them.

Change the function signature from:
```typescript
export const addMessageToChat = (
	view: HydrateView,
	role: "user" | "agent" | "system",
	content: string,
	isError: boolean = false,
): void => {
```

To:
```typescript
export const addMessageToChat = (
	view: HydrateView,
	role: "user" | "agent" | "system",
	content: string,
	isError: boolean = false,
	images?: { data: string; mimeType: string }[],
): void => {
```

**Step 2: Render images in the message**

After creating `messageEl` and before rendering markdown content, add:

```typescript
	// Render images if present
	if (images && images.length > 0) {
		const imagesContainer = messageEl.createDiv({
			cls: "hydrate-message-images",
		});
		imagesContainer.style.cssText = `
			display: flex;
			flex-wrap: wrap;
			gap: 8px;
			margin-bottom: 8px;
		`;

		images.forEach((img) => {
			const imgEl = document.createElement("img");
			imgEl.src = `data:${img.mimeType};base64,${img.data}`;
			imgEl.style.cssText = `
				max-width: 200px;
				max-height: 200px;
				border-radius: 4px;
				border: 1px solid var(--background-modifier-border);
			`;
			imagesContainer.appendChild(imgEl);
		});
	}
```

**Step 3: Update handleSend to pass images to addMessageToChat**

In `eventHandlers.ts`, where the user message is added to chat, pass the images:

Find (around line 430):
```typescript
	addMessageToChat(view, "user", originalMessageContent);
```

Change to:
```typescript
	addMessageToChat(
		view,
		"user",
		originalMessageContent,
		false,
		view.attachedImages.map((img) => ({ data: img.data, mimeType: img.mimeType }))
	);
```

**Step 4: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add src/components/HydrateView/domUtils.ts src/components/HydrateView/eventHandlers.ts
git commit -m "feat: display images in chat message history"
```

---

## Task 13: Integration Test

**Files:** None (manual testing)

**Step 1: Build frontend**

Run: `cd /Users/jamie/Code/hydrate-vault/.obsidian/plugins/hydrate && npm run build`

**Step 2: Restart backend**

Run: `cd /Users/jamie/Code/hydrate-vault && source venv/bin/activate && python src/main.py`

**Step 3: Test drag-drop**

1. Open Obsidian with the Hydrate plugin
2. Open the Hydrate chat pane
3. Drag an image file into the chat input
4. Verify: Image preview appears with X button
5. Click X to remove, verify preview disappears

**Step 4: Test paste**

1. Copy an image to clipboard (screenshot or copy from browser)
2. Paste into the chat input (Cmd+V / Ctrl+V)
3. Verify: Image preview appears

**Step 5: Test send with image**

1. Add an image via drag or paste
2. Type "What's in this image?"
3. Click Send
4. Verify: Image appears in chat history
5. Verify: Model responds with description of the image

**Step 6: Test with different models**

- GPT-4o: Should work
- Claude: Should work
- Gemini: Should work

**Step 7: Final commit**

```bash
git add -A
git commit -m "feat: complete image input support - drag, drop, paste, send to vision models"
```

---

## Summary of All Files Modified

| File | Changes |
|------|---------|
| `src/types.ts` | Add `ImageAttachment` interface, extend `ChatTurn` |
| `src/components/HydrateView/hydrateView.ts` | Add `attachedImages` state, paste listener |
| `src/components/HydrateView/imageUtils.ts` | **NEW** - Image validation and conversion utilities |
| `src/components/HydrateView/eventHandlers.ts` | Handle image drop/paste, include images in payload |
| `src/components/HydrateView/domUtils.ts` | Render image previews and images in chat |
| `src/main.py` | Add `ImageContent` model, extend `ChatRequest` |
| `src/agent.py` | Build multimodal `HumanMessage` with images |
