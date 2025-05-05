import {
	App,
	TFile,
	// TAbstractFile, // No longer needed
	normalizePath,
	requestUrl,
	RequestUrlParam,
	Notice,
	FileSystemAdapter, // Import FileSystemAdapter
} from "obsidian";
import { LocalIndex, QueryResult as VectraQueryResult } from "vectra";

// Manually define the Item interface based on Vectra's expected structure
interface VectraItem<M extends Record<string, unknown>> {
	vector: number[];
	metadata: M;
	id: string; // Add id field for Vectra item identification
}

// Define a simple tokenizer to avoid issues with gpt-3-encoder in Obsidian environment
class SimpleObsidianTokenizer {
	encode(text: string): number[] {
		// This is a placeholder. Vectra might use it for internal purposes we are not aware of.
		// For our primary use (semantic search with externally provided embeddings), this should suffice.
		// If Vectra uses token counts for something critical even in vector-only mode, this might need refinement.
		console.warn(
			"[SimpleObsidianTokenizer] encode called. This is a basic placeholder."
		);
		return text.split(" ").map((s) => s.length); // Example: return array of word lengths
	}
}

// Define the structure for metadata stored in Vectra
interface VectraMetadata {
	filePath: string;
	chunkId: string; // e.g., filePath#0
	[key: string]: string | number | boolean; // Index signature for Vectra compatibility
}

// Re-define interfaces needed here, or import from types.ts if preferred
interface DocumentChunk {
	id: string; // e.g., filePath + #chunkIndex
	filePath: string;
	embedding: number[];
	// text?: string; // Text is not stored in the index, but could be part of this interface for other uses
	score?: number; // Optional: for search results
}

// interface IndexedDocument { // No longer needed with Vectra
// 	filePath: string;
// 	mtime: number;
// 	chunks: DocumentChunk[];
// }

// interface VectorStore { // No longer needed with Vectra
// 	documents: Record<string, IndexedDocument>;
// }

// Define a more specific type for the settings parameter used in this file
export interface VectorIndexSettings {
	enableRemoteEmbeddings: boolean;
	remoteEmbeddingUrl: string;
	remoteEmbeddingApiKey: string;
	remoteEmbeddingModelName: string;
	indexFileExtensions: string; // Added this field
}

// --- Globals (If needed for index store) ---
// let vectorStore: VectorStore | null = null; // Replaced by localIndex
let localIndex: LocalIndex<VectraMetadata> | null = null;

// --- Constants (moved from old file if needed, or define new ones) ---
const INDEX_DIR_NAME = ".hydrate/index"; // Vectra will use this directory
// const INDEX_FILE_NAME = "vector_index.json"; // No longer needed

// --- Remote Embedding Function (Now with full implementation) ---

/**
 * Generates embeddings for given texts using a remote OpenAI-compatible API endpoint.
 *
 * @param texts An array of text strings to embed.
 * @param apiUrl The URL of the embedding API endpoint.
 * @param apiKey The API key for authentication.
 * @param modelName The name of the embedding model to use.
 * @returns A Promise resolving to an array of embedding arrays (number[][]).
 * @throws An error if the API call fails or the response is invalid.
 */
async function embedTextsViaRemoteApi(
	texts: string[],
	apiUrl: string,
	apiKey: string,
	modelName: string
): Promise<number[][]> {
	// --- Parameter Validation ---
	if (!apiUrl || !apiKey || !modelName) {
		// Log specific missing items
		const missing = [];
		if (!apiUrl) missing.push("API URL");
		if (!apiKey) missing.push("API Key");
		if (!modelName) missing.push("Model Name");
		const errorMsg = `Remote embedding configuration (${missing.join(
			", "
		)}) is incomplete.`;
		console.error(`[embedTextsViaRemoteApi] Error: ${errorMsg}`);
		new Notice(`Error: ${errorMsg}`); // Notify user
		throw new Error(errorMsg);
	}
	if (!texts || texts.length === 0) {
		console.log("[embedTextsViaRemoteApi] No texts provided to embed.");
		return []; // Nothing to embed
	}
	// Filter out any empty strings, as some APIs reject them
	const validTexts = texts.filter((t) => t && t.trim().length > 0);
	if (validTexts.length === 0) {
		console.log(
			"[embedTextsViaRemoteApi] All provided texts were empty after trimming."
		);
		return [];
	}
	if (validTexts.length < texts.length) {
		console.warn(
			`[embedTextsViaRemoteApi] Filtered out ${
				texts.length - validTexts.length
			} empty texts.`
		);
		// Note: This means the returned embeddings array might not map 1:1 to the original `texts` array if it contained empties.
		// The calling function needs to be aware of this or handle the mapping if necessary.
		// For simplicity now, we proceed with validTexts.
	}

	// --- Logging ---
	console.log(
		`[embedTextsViaRemoteApi] Requesting embeddings for ${validTexts.length} non-empty text chunk(s)`
	);
	console.log(`[embedTextsViaRemoteApi] API URL: ${apiUrl}`);
	console.log(`[embedTextsViaRemoteApi] API Key Provided: ${!!apiKey}`);
	console.log(`[embedTextsViaRemoteApi] Model Name: ${modelName}`);

	// --- Prepare Request ---
	const requestBody = JSON.stringify({
		input: validTexts, // Use the filtered array
		model: modelName,
		// encoding_format: "float", // Optional
	});

	const requestParams: RequestUrlParam = {
		url: apiUrl,
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: requestBody,
		throw: false, // Handle errors manually
	};

	console.log("[embedTextsViaRemoteApi] Making request with params:", {
		url: requestParams.url,
		method: requestParams.method,
		headers: {
			...requestParams.headers,
			Authorization: "Bearer [REDACTED]",
		},
		bodyLength: requestBody.length,
	});

	// --- Execute API Call ---
	try {
		const response = await requestUrl(requestParams); // <<< THE ACTUAL API CALL

		// --- Log Raw Response ---
		console.log(
			"[embedTextsViaRemoteApi] Raw Response Status:",
			response.status
		);
		console.log(
			"[embedTextsViaRemoteApi] Raw Response JSON available:",
			!!response.json
		);

		// --- Process Response ---
		const responseData = response.json;

		if (response.status >= 400) {
			const errorDetail =
				responseData?.error?.message ||
				responseData?.detail ||
				JSON.stringify(responseData); // Try common error fields
			const errorMsg = `Remote Embedding API request failed with status ${response.status}: ${errorDetail}`;
			console.error(
				"[embedTextsViaRemoteApi] API Error Response:",
				responseData
			);
			new Notice(`Embedding Error: ${errorMsg}`);
			throw new Error(errorMsg);
		}

		if (
			!responseData ||
			!responseData.data ||
			!Array.isArray(responseData.data)
		) {
			console.error(
				"[embedTextsViaRemoteApi] Invalid response structure:",
				responseData
			);
			throw new Error(
				"Invalid response structure from Remote Embedding API."
			);
		}

		// Ensure the number of embeddings matches the number of valid inputs sent
		if (responseData.data.length !== validTexts.length) {
			console.warn(
				`[embedTextsViaRemoteApi] Mismatch: ${validTexts.length} texts sent, ${responseData.data.length} embeddings received.`
			);
			// Decide how to handle: throw error, return partial, or try to map. For now, throwing if mismatch.
			// If the API guarantees order and length, this check is crucial.
			// If it can return fewer for some reason (e.g. internal errors on specific texts), this needs robust handling.
			throw new Error(
				"Mismatch between number of input texts and returned embeddings."
			);
		}

		// Extract embeddings, expecting OpenAI format: { data: [ { embedding: [...] }, ... ] }
		const embeddings = responseData.data
			.map((item: any, index: number) => {
				if (item && item.embedding && Array.isArray(item.embedding)) {
					return item.embedding;
				} else {
					console.error(
						`[embedTextsViaRemoteApi] Invalid embedding item structure at index ${index}:`,
						item
					);
					// Throw an error if any item is invalid, preventing partial results
					throw new Error(
						`Invalid embedding item received at index ${index}.`
					);
				}
			})
			// Filter out any potential nulls/undefined if map logic were different, though the throw prevents this now
			.filter((e: number[] | null): e is number[] => e !== null);

		// Final check if filtering/mapping resulted in unexpected length
		if (embeddings.length !== responseData.data.length) {
			console.error(
				"[embedTextsViaRemoteApi] Error processing embedding items from response data."
			);
			throw new Error(
				"Failed to process all embedding items from API response."
			);
		}

		console.log(
			`[embedTextsViaRemoteApi] Successfully parsed ${embeddings.length} embeddings.`
		);
		return embeddings;
	} catch (error) {
		console.error(
			"[embedTextsViaRemoteApi] Error during API call or processing:",
			error
		);
		// Make error message more informative if possible
		const message = error instanceof Error ? error.message : String(error);
		if (!message.startsWith("Remote Embedding API request failed")) {
			// Avoid redundant notices if error came from status check
			new Notice(
				`Failed to fetch remote embeddings. Check console/settings. Error: ${message}`
			);
		}
		// Re-throw the original error or a new one
		throw new Error(`Failed to get remote embeddings: ${message}`);
	}
}

// --- Index Management Functions (Add back implementations) ---

/**
 * Loads the vector index from the .hydrate_index directory in the vault.
 * @param app Obsidian App instance.
 */
// async function loadIndex(app: App): Promise<void> { // Replaced by initializeVectorSystem with Vectra
// ... removed loadIndex implementation ...
// }

/**
 * Saves the vector index to the .hydrate_index directory in the vault.
 * @param app Obsidian App instance.
 */
// async function saveIndex(app: App): Promise<void> { // Vectra handles its own persistence
// ... removed saveIndex implementation ...
// }

/**
 * Chunks a document's content into smaller pieces.
 * @param content The document content.
 * @param filePath The path of the file for chunk IDs.
 * @returns Array of text chunks.
 */
function chunkDocumentContent(
	content: string,
	filePath: string
): { id: string; text: string }[] {
	// Ensure content is not empty or just whitespace
	const trimmedContent = content.trim();
	if (trimmedContent.length === 0) {
		console.log(
			`[chunkDocumentContent] Content for ${filePath} is empty after trimming. Returning no chunks.`
		);
		return [];
	}

	// Return the entire trimmed content as a single chunk
	// The ID uses '#0' to signify the single chunk for the whole file.
	return [
		{
			id: `${filePath}#0`,
			text: trimmedContent,
		},
	];
}

/**
 * Adds or updates a document in the vector index using remote embeddings.
 * Requires plugin settings to be passed in.
 * @param app Obsidian App instance.
 * @param file TFile to index.
 * @param settings Plugin settings including remote embedding config and file extensions.
 */
export async function addOrUpdateDocumentRemote(
	app: App,
	file: TFile,
	settings: VectorIndexSettings // Use the specific settings type defined in this file
): Promise<void> {
	if (!localIndex) {
		console.error(
			"[addOrUpdateDocumentRemote] Vectra index not initialized. Cannot index document."
		);
		new Notice("Hydrate: Vector index not ready. Cannot index.");
		return;
	}

	if (!settings.enableRemoteEmbeddings) {
		// If remote embeddings are disabled, ensure the document is removed from the index
		// as it might have been indexed previously when settings were different.
		console.log(
			`[addOrUpdateDocumentRemote] Remote embeddings disabled. Ensuring ${file.path} is not in index.`
		);
		await deleteDocumentFromIndex(app, file.path); // Call delete to ensure removal
		return;
	}

	const fileExtension = file.extension.toLowerCase();
	const allowedExtensionsString = settings.indexFileExtensions || "";
	const allowedExtensions = allowedExtensionsString
		.split(",")
		.map((ext) => ext.trim().toLowerCase())
		.filter((ext) => ext.length > 0);

	if (allowedExtensions.length === 0) {
		console.log(
			`[addOrUpdateDocumentRemote] No file extensions configured. Ensuring ${file.path} is not in index.`
		);
		await deleteDocumentFromIndex(app, file.path);
		return;
	}

	if (!allowedExtensions.includes(fileExtension)) {
		// console.log(`[addOrUpdateDocumentRemote] File extension '.${fileExtension}' not allowed. Ensuring ${file.path} is not in index.`);
		await deleteDocumentFromIndex(app, file.path);
		return;
	}

	console.log(
		`[addOrUpdateDocumentRemote] Starting indexing for: ${file.path} (type: ${fileExtension})`
	);
	try {
		const content = await app.vault.cachedRead(file);
		const textChunksForEmbedding = chunkDocumentContent(content, file.path);

		if (textChunksForEmbedding.length === 0) {
			console.log(
				`[addOrUpdateDocumentRemote] No content to index for ${file.path}. Ensuring it's removed.`
			);
			await deleteDocumentFromIndex(app, file.path); // Ensure it's removed if it existed
			return;
		}

		const chunkTextsApi = textChunksForEmbedding.map((c) => c.text);
		let embeddings: number[][] = [];
		try {
			embeddings = await embedTextsViaRemoteApi(
				chunkTextsApi,
				settings.remoteEmbeddingUrl,
				settings.remoteEmbeddingApiKey,
				settings.remoteEmbeddingModelName
			);
		} catch (embeddingError) {
			console.error(
				`[addOrUpdateDocumentRemote] Failed to get embeddings for ${file.path}:`,
				embeddingError
			);
			// Optionally, attempt to remove the document from index if fetching embeddings fails,
			// to prevent stale data if it was previously indexed.
			// await deleteDocumentFromIndex(app, file.path);
			return;
		}

		if (embeddings.length !== textChunksForEmbedding.length) {
			console.error(
				`[addOrUpdateDocumentRemote] Mismatch: Got ${embeddings.length} embeddings for ${textChunksForEmbedding.length} chunks in ${file.path}. Aborting update.`
			);
			new Notice(
				`Indexing error for ${file.path}: Embedding count mismatch.`
			);
			return;
		}

		// Add/update items in Vectra index
		for (let i = 0; i < textChunksForEmbedding.length; i++) {
			const chunk = textChunksForEmbedding[i];
			const embedding = embeddings[i];

			const vectraItem: VectraItem<VectraMetadata> = {
				id: chunk.id, // Ensure item ID is part of the object
				vector: embedding,
				metadata: {
					filePath: file.path,
					chunkId: chunk.id,
				},
			};
			try {
				// Use chunk.id as the item ID for Vectra for upsert operations
				await localIndex.upsertItem(vectraItem); // Pass only the item object
			} catch (vectraError) {
				console.error(
					`[addOrUpdateDocumentRemote] Error upserting item ${chunk.id} to Vectra for ${file.path}:`,
					vectraError
				);
				new Notice(
					`Error indexing chunk ${chunk.id} for ${file.path}.`
				);
				// Decide if to continue with other chunks or abort
			}
		}
		console.log(
			`[addOrUpdateDocumentRemote] Document ${file.path} processed with ${textChunksForEmbedding.length} chunks for Vectra index.`
		);
		// No explicit saveIndex(app) needed; Vectra manages its persistence.
	} catch (error) {
		console.error(
			`[addOrUpdateDocumentRemote] Unexpected error indexing document ${file.path}:`,
			error
		);
	}
}

/**
 * Removes a document (all its chunks) from the vector index.
 * @param app Obsidian App instance.
 * @param filePath Path of the file to remove.
 */
export async function deleteDocumentFromIndex(
	app: App,
	filePath: string
): Promise<void> {
	if (!localIndex) {
		console.warn(
			"[deleteDocumentFromIndex] Vectra index not initialized. Cannot delete."
		);
		return;
	}

	const chunkIdToDelete = `${filePath}#0`;

	try {
		// deleteItem returns void, so don't check for truthiness
		await localIndex.deleteItem(chunkIdToDelete);
		console.log(
			`[deleteDocumentFromIndex] Attempted removal of document chunk ${chunkIdToDelete} (for file ${filePath}) from Vectra index.`
		);
		// Note: Vectra's deleteItem doesn't explicitly confirm success/failure if item not found in same way.
		// It will throw an error if the deletion fails for other reasons.
	} catch (error) {
		console.error(
			`[deleteDocumentFromIndex] Error removing document chunk ${chunkIdToDelete} (for file ${filePath}) from Vectra index:`,
			error
		);
		new Notice(`Error deleting ${filePath} from index. Check console.`);
	}
}

/**
 * Searches the local index for relevant chunks using a query embedded via remote API.
 * @param query The search query.
 * @param settings Plugin settings including remote embedding config.
 * @param topN Number of top results to return.
 * @returns Array of top matching DocumentChunks (potentially with score).
 */
export async function searchIndexRemote(
	query: string,
	settings: VectorIndexSettings,
	topN: number = 5
): Promise<DocumentChunk[]> {
	if (!localIndex) {
		console.warn(
			"[searchIndexRemote] Vectra index not initialized. Cannot search."
		);
		throw new Error("Local Vectra index not initialized for search.");
	}
	if (!settings.enableRemoteEmbeddings) {
		console.warn(
			"[searchIndexRemote] Remote embeddings disabled. Cannot perform search."
		);
		throw new Error("Remote embeddings disabled. Cannot perform search.");
	}

	let queryEmbedding: number[];
	try {
		const embeddingsResult = await embedTextsViaRemoteApi(
			[query],
			settings.remoteEmbeddingUrl,
			settings.remoteEmbeddingApiKey,
			settings.remoteEmbeddingModelName
		);
		if (
			!embeddingsResult ||
			embeddingsResult.length === 0 ||
			!embeddingsResult[0]
		) {
			throw new Error("Remote API returned no embedding for the query.");
		}
		queryEmbedding = embeddingsResult[0];
	} catch (error) {
		console.error(
			"[searchIndexRemote] Failed to get query embedding:",
			error
		);
		new Notice(
			`Search failed: Could not get query embedding. ${
				error instanceof Error ? error.message : ""
			}`
		);
		throw new Error(
			`Failed to generate query embedding via remote API: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
	}

	if (!queryEmbedding || queryEmbedding.length === 0) {
		console.error("[searchIndexRemote] Query embedding is empty.");
		new Notice("Search failed: Query embedding is empty.");
		throw new Error(
			"Failed to generate query embedding (result was empty or invalid)."
		);
	}

	try {
		// Using the user-specified queryItems call structure
		const results: VectraQueryResult<VectraMetadata>[] =
			await localIndex.queryItems(queryEmbedding, "", topN);

		if (!results) {
			console.warn(
				"[searchIndexRemote] Vectra queryItems returned null or undefined."
			);
			return [];
		}

		console.log(
			`[searchIndexRemote] Vectra query returned ${results.length} results.`
		);

		return results.map((res: VectraQueryResult<VectraMetadata>) => {
			const metadata = res.item.metadata; // Access metadata safely
			const filePath = metadata?.filePath || "unknown_filepath";
			const chunkId = metadata?.chunkId || "unknown_chunk_id";

			if (
				filePath === "unknown_filepath" ||
				chunkId === "unknown_chunk_id"
			) {
				console.warn(
					"[searchIndexRemote] Query result item has missing filePath or chunkId in metadata:",
					metadata
				);
			}

			return {
				id: chunkId,
				filePath: filePath,
				embedding: res.item.vector as number[],
				score: res.score,
			};
		});
	} catch (error) {
		console.error(
			"[searchIndexRemote] Error querying Vectra index:",
			error
		);
		new Notice(
			`Search failed: Error querying index. ${
				error instanceof Error ? error.message : ""
			}`
		);
		throw new Error(
			`Error querying Vectra index: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
	}
}

// Removed cosineSimilarity function as Vectra handles this.

/**
 * Main initialization function for the vector indexing system using Vectra.
 * Creates or loads the Vectra local index.
 * @param app Obsidian App instance
 */
export async function initializeVectorSystem(app: App) {
	console.log(
		"[initializeVectorSystem] Initializing Vectra vector system..."
	);
	try {
		// Correctly get base path using FileSystemAdapter
		const adapter = app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) {
			console.error(
				"[initializeVectorSystem] Vault adapter is not a FileSystemAdapter. Cannot get base path for Vectra index."
			);
			new Notice(
				"Hydrate: Cannot initialize vector index due to adapter type. Context search may not work."
			);
			localIndex = null;
			return;
		}
		const vaultBasePath = adapter.getBasePath();
		const absoluteIndexDirPath = normalizePath(
			`${vaultBasePath}/${INDEX_DIR_NAME}`
		);

		console.log(
			`[initializeVectorSystem] Vectra index path: ${absoluteIndexDirPath}`
		);

		const indexDirVaultPath = normalizePath(INDEX_DIR_NAME);
		if (!(await app.vault.adapter.exists(indexDirVaultPath))) {
			console.log(
				`[initializeVectorSystem] Creating Vectra index directory: ${indexDirVaultPath}`
			);
			await app.vault.adapter.mkdir(indexDirVaultPath);
		}

		localIndex = new LocalIndex<VectraMetadata>(absoluteIndexDirPath); // Specify metadata type

		if (!(await localIndex.isIndexCreated())) {
			console.log(
				"[initializeVectorSystem] Vectra index not found. Creating new index..."
			);
			await localIndex.createIndex();
			console.log(
				"[initializeVectorSystem] New Vectra index created successfully."
			);
		} else {
			console.log(
				"[initializeVectorSystem] Existing Vectra index loaded."
			);
		}
	} catch (error) {
		localIndex = null;
		console.error(
			"[initializeVectorSystem] Failed to initialize Vectra vector system:",
			error
		);
		new Notice(
			"Hydrate: Failed to initialize vector index. Context search may not work. Check console."
		);
	}
}
