import { remark } from "remark";
import remarkGfm from "remark-gfm";
import {
	Root,
	Table,
	TableRow,
	TableCell,
	Heading,
	Text,
	Paragraph,
	Strong,
	Node,
	Parent,
} from "mdast";
import * as path from "path"; // For inferFileType, if used in future scan
import * as fs from "fs/promises"; // Corrected import

export interface FileEntry {
	name: string;
	purpose: string;
	type: string; // e.g., 'markdown', 'code', 'config', 'other'
	modified: string; // ISO date string, e.g., YYYY-MM-DD
}

export interface DirectoryManifest {
	purpose: string;
	type: "docs" | "code" | "mixed" | "other";
	domain?: string;
	contents: FileEntry[];
	children: string[];
	parent?: string;
	// Raw AST nodes for sections not explicitly parsed, to allow round-tripping later?
	// unknownSections?: Node[];
}

// Helper function to extract text content from a generic MDAST node
function nodeToText(node: Node | undefined): string {
	if (!node) return "";
	if ("value" in node) {
		// The `in` operator type guard is not correctly narrowing the `Node` union type.
		// Casting to a simple object with a `value` property bypasses the type error.
		return String((node as { value: unknown }).value);
	}
	if ("children" in node && Array.isArray((node as Parent).children)) {
		return (node as Parent).children.map(nodeToText).join("");
	}
	return "";
}

function inferFileType(filename: string): string {
	const ext = path.extname(filename).toLowerCase().substring(1);
	const typeMap: Record<string, string> = {
		md: "markdown",
		ts: "code",
		js: "code",
		tsx: "code",
		jsx: "code",
		py: "code",
		java: "code",
		c: "code",
		cpp: "code",
		cs: "code",
		go: "code",
		rb: "code",
		php: "code",
		swift: "code",
		kt: "code",
		rs: "code",
		json: "config",
		yaml: "config",
		yml: "config",
		toml: "config",
		xml: "config",
		html: "web",
		css: "web",
		scss: "web",
		less: "web",
		vue: "code",
		svelte: "code",
		sh: "script",
		bat: "script",
		ps1: "script",
		pdf: "document",
		doc: "document",
		docx: "document",
		xls: "spreadsheet",
		xlsx: "spreadsheet",
		ppt: "presentation",
		pptx: "presentation",
		png: "image",
		jpg: "image",
		jpeg: "image",
		gif: "image",
		svg: "image",
		zip: "archive",
		tar: "archive",
		gz: "archive",
	};
	return typeMap[ext] || "other";
}

export class ManifestFile {
	private processor = remark().use(remarkGfm);
	private manifest: DirectoryManifest;

	constructor(manifest: DirectoryManifest) {
		this.manifest = manifest;
	}

	public getManifest(): DirectoryManifest {
		return JSON.parse(JSON.stringify(this.manifest)); // Return a deep copy
	}

	public updateFields(updates: {
		purpose?: string;
		type?: "docs" | "code" | "mixed" | "other";
		domain?: string;
	}): void {
		if (updates.purpose !== undefined) {
			this.manifest.purpose = updates.purpose;
		}
		if (updates.type !== undefined) {
			this.manifest.type = updates.type;
		}
		if (updates.domain !== undefined) {
			// Allow setting domain to an empty string or null to remove it
			this.manifest.domain = updates.domain;
		}
	}

	public updateManifest(updatedFields: Partial<DirectoryManifest>): void {
		this.manifest = { ...this.manifest, ...updatedFields };
	}

	// --- SERIALIZATION (Object to Markdown) ---
	public toString(): string {
		const children: Node[] = [];

		children.push(this.createHeading(1, "Directory Manifest"));
		children.push(this.createMetadataParagraph());

		if (this.manifest.contents && this.manifest.contents.length > 0) {
			children.push(this.createHeading(2, "Contents"));
			children.push(this.createContentsTable());
		}

		if (
			this.manifest.parent ||
			(this.manifest.children && this.manifest.children.length > 0)
		) {
			children.push(this.createHeading(2, "Structure"));
			children.push(this.createStructureParagraph());
		}

		const ast: Root = {
			type: "root",
			children: children as Root["children"], // Cast needed as children array is built dynamically
		};
		return this.processor.stringify(ast);
	}

	private createHeading(depth: 1 | 2 | 3 | 4 | 5 | 6, text: string): Heading {
		return {
			type: "heading",
			depth,
			children: [{ type: "text", value: text } as Text],
		};
	}

	private createMetadataParagraph(): Paragraph {
		const children: (Strong | Text)[] = [];

		children.push({
			type: "strong",
			children: [{ type: "text", value: "Purpose" }],
		});
		children.push({ type: "text", value: `: ${this.manifest.purpose}` });

		children.push({ type: "text", value: "\n" }); // Newline for next item
		children.push({
			type: "strong",
			children: [{ type: "text", value: "Type" }],
		});
		children.push({ type: "text", value: `: ${this.manifest.type}` });

		if (this.manifest.domain) {
			children.push({ type: "text", value: "\n" });
			children.push({
				type: "strong",
				children: [{ type: "text", value: "Domain" }],
			});
			children.push({ type: "text", value: `: ${this.manifest.domain}` });
		}
		return { type: "paragraph", children };
	}

	private createContentsTable(): Table {
		const headerRow: TableRow = {
			type: "tableRow",
			children: [
				{
					type: "tableCell",
					children: [{ type: "text", value: "File" } as Text],
				},
				{
					type: "tableCell",
					children: [{ type: "text", value: "Purpose" } as Text],
				},
				{
					type: "tableCell",
					children: [{ type: "text", value: "Type" } as Text],
				},
				{
					type: "tableCell",
					children: [{ type: "text", value: "Modified" } as Text],
				},
			],
		};

		const dataRows: TableRow[] = this.manifest.contents.map((file) => ({
			type: "tableRow",
			children: [
				{
					type: "tableCell",
					children: [{ type: "text", value: file.name } as Text],
				},
				{
					type: "tableCell",
					children: [{ type: "text", value: file.purpose } as Text],
				},
				{
					type: "tableCell",
					children: [{ type: "text", value: file.type } as Text],
				},
				{
					type: "tableCell",
					children: [{ type: "text", value: file.modified } as Text],
				},
			],
		}));

		return {
			type: "table",
			align: ["left", "left", "left", "left"], // Default alignment
			children: [headerRow, ...dataRows],
		};
	}

	private createStructureParagraph(): Paragraph {
		const children: (Text | Strong)[] = [];
		if (this.manifest.parent) {
			children.push({
				type: "strong",
				children: [{ type: "text", value: "Parent" }],
			});
			children.push({ type: "text", value: `: ${this.manifest.parent}` });
		}

		if (this.manifest.children && this.manifest.children.length > 0) {
			if (children.length > 0)
				children.push({ type: "text", value: "\n" }); // Add newline if parent was present
			children.push({
				type: "strong",
				children: [{ type: "text", value: "Children" }],
			});
			children.push({ type: "text", value: ":" });
			this.manifest.children.forEach((child) => {
				children.push({ type: "text", value: `\n  - ${child}` });
			});
		}
		return { type: "paragraph", children };
	}

	// --- DESERIALIZATION (Markdown to Object) ---
	public static fromString(markdown: string): ManifestFile {
		const processor = remark().use(remarkGfm);
		const ast = processor.parse(markdown) as Root;

		let purpose = "";
		let type: DirectoryManifest["type"] = "other";
		let domain: string | undefined = undefined;
		const contents: FileEntry[] = [];
		let parent: string | undefined = undefined;
		const children: string[] = [];

		const metadataParagraph = ast.children.find(
			(node) =>
				node.type === "paragraph" &&
				node.children.some(
					(child) =>
						child.type === "strong" &&
						nodeToText(child).includes("Purpose")
				)
		) as Paragraph | undefined;

		if (metadataParagraph) {
			const textContent = nodeToText(metadataParagraph);
			const purposeMatch = textContent.match(/Purpose:\s*([^\n]+)/i);
			if (purposeMatch) purpose = purposeMatch[1].trim();

			const typeMatch = textContent.match(/Type:\s*([^\n]+)/i);
			if (typeMatch) {
				const parsedType = typeMatch[1].trim().toLowerCase();
				if (["docs", "code", "mixed", "other"].includes(parsedType)) {
					type = parsedType as DirectoryManifest["type"];
				}
			}
			const domainMatch = textContent.match(/Domain:\s*([^\n]+)/i);
			if (domainMatch) domain = domainMatch[1].trim();
		}

		const contentsHeading = ast.children.find(
			(node) =>
				node.type === "heading" &&
				node.depth === 2 &&
				nodeToText(node) === "Contents"
		);
		if (contentsHeading) {
			const tableNodeIndex = ast.children.indexOf(contentsHeading) + 1;
			const tableNode = ast.children[tableNodeIndex];
			if (tableNode && tableNode.type === "table") {
				const [headerRow, ...dataRows] = (tableNode as Table).children;
				dataRows.forEach((row) => {
					if (row.type === "tableRow") {
						const cells = row.children.map((cell) =>
							nodeToText(cell)
						);
						if (cells.length >= 4) {
							// Ensure all columns are present
							contents.push({
								name: cells[0],
								purpose: cells[1],
								type: cells[2] || inferFileType(cells[0]), // Fallback if type is empty in table
								modified:
									cells[3] ||
									new Date().toISOString().split("T")[0], // Fallback for modified
							});
						}
					}
				});
			}
		}

		const structureHeading = ast.children.find(
			(node) =>
				node.type === "heading" &&
				node.depth === 2 &&
				nodeToText(node) === "Structure"
		);
		if (structureHeading) {
			const structureParagraphIndex =
				ast.children.indexOf(structureHeading) + 1;
			const structureNode = ast.children[structureParagraphIndex];
			if (structureNode && structureNode.type === "paragraph") {
				const textContent = nodeToText(structureNode);
				const parentMatch = textContent.match(/Parent:\s*([^\n]+)/i);
				if (parentMatch) parent = parentMatch[1].trim();

				const childrenMatch = textContent.match(
					/Children:\s*([\s\S]+)/i
				);
				if (childrenMatch) {
					const childrenBlock = childrenMatch[1].trim();
					const childLines = childrenBlock
						.split("\n")
						.map((line) => line.trim());
					childLines.forEach((line) => {
						if (line.startsWith("- ")) {
							children.push(line.substring(2).trim());
						}
					});
				}
			}
		}

		const manifestData: DirectoryManifest = {
			purpose,
			type,
			domain,
			contents,
			parent,
			children,
		};
		return new ManifestFile(manifestData);
	}

	public static createDefaultManifest(
		dirPath: string,
		vaultName: string
	): ManifestFile {
		const dirName = path.basename(dirPath);
		let parentPath: string | undefined = path.dirname(dirPath);
		// Make parent path relative to vault root if possible for readability
		if (parentPath === "." || parentPath === vaultName) {
			parentPath = "../"; // Indicate root or one level up from a root folder
		} else {
			parentPath = `../${path.basename(parentPath)}`;
		}
		if (dirPath.split(path.sep).length <= 1 && parentPath === "../") {
			// Top level folder in vault
			parentPath = undefined;
		}

		const manifestData: DirectoryManifest = {
			purpose: `Manifest for directory: ${dirName}`,
			type: "mixed", // Default type, can be changed by user or future scanning logic
			domain: undefined, // No default domain
			contents: [], // Initially empty, to be populated by scanning or manually
			children: [], // Initially empty, to be populated by scanning
			parent: parentPath,
		};
		return new ManifestFile(manifestData);
	}

	static async scanDirectory(
		dirPath: string,
		vaultName: string,
		appVault?: any
	): Promise<ManifestFile> {
		const MANIFEST_FILE_NAME_LOWERCASE = ".hydrate-manifest.md"; // Lowercase for case-insensitive check
		let existingManifestData: DirectoryManifest | undefined = undefined;
		const existingManifestPath = path.join(
			dirPath,
			MANIFEST_FILE_NAME_LOWERCASE
		);

		try {
			// In a real Obsidian plugin, you'd use app.vault.adapter.read for vault files
			// For now, we'll use fs for broader compatibility during standalone testing if appVault is not passed
			let manifestContent: string | null = null;
			if (appVault && typeof appVault.adapter?.read === "function") {
				if (await appVault.adapter.exists(existingManifestPath)) {
					manifestContent = await appVault.adapter.read(
						existingManifestPath
					);
				}
			} else if (fs) {
				if (
					await fs
						.stat(existingManifestPath)
						.then(() => true)
						.catch(() => false)
				) {
					manifestContent = await fs.readFile(
						existingManifestPath,
						"utf-8"
					);
				}
			}

			if (manifestContent) {
				existingManifestData =
					ManifestFile.fromString(manifestContent).getManifest();
				console.log(`Hydrate: Found existing manifest in ${dirPath}`);
			}
		} catch (error) {
			// if (error.code !== "ENOENT") { // ENOENT is file not found, which is fine
			console.warn(
				`Hydrate: Error reading existing manifest in ${dirPath}, creating new.`,
				error
			);
			// }
		}

		const files = appVault
			? (await appVault.adapter.list(dirPath)).files
			: await fs.readdir(dirPath);
		const subFolders = appVault
			? (await appVault.adapter.list(dirPath)).folders
			: []; // fs.readdir doesn't distinguish

		const contents: FileEntry[] = [];
		const childrenDirectories: string[] = [];

		for (const itemName of files) {
			const fullItemPath = path.join(dirPath, itemName);
			if (itemName.toLowerCase() === MANIFEST_FILE_NAME_LOWERCASE)
				continue;
			if (itemName.startsWith(".")) continue; // Skip hidden files/folders

			// In a real plugin, TAbstractFile would give isFile/isFolder directly
			// Here, we try to stat. If appVault is present, assume files from appVault.adapter.list().files ARE files.
			let itemStats;
			let isFile = true; // Assume file if from appVault.adapter.list().files

			if (!appVault) {
				// if using fs, we need to stat
				try {
					itemStats = await fs.stat(fullItemPath);
					isFile = itemStats.isFile();
				} catch (e) {
					console.warn(
						`Hydrate: Could not stat ${fullItemPath}, skipping.`
					);
					continue;
				}
			}

			if (isFile) {
				const existingEntry = existingManifestData?.contents.find(
					(f) => f.name === itemName
				);
				contents.push({
					name: itemName,
					purpose: existingEntry?.purpose || "", // Preserve purpose if found
					type: inferFileType(itemName),
					modified: itemStats
						? itemStats.mtime.toISOString().split("T")[0]
						: new Date().toISOString().split("T")[0], // Fallback for appVault scenario
				});
			}
			// Folder handling will be separate if not using appVault
		}

		if (!appVault) {
			// Manual folder scan if using fs
			for (const itemName of await fs.readdir(dirPath)) {
				if (itemName.startsWith(".")) continue;
				const fullItemPath = path.join(dirPath, itemName);
				try {
					const itemStats = await fs.stat(fullItemPath);
					if (itemStats.isDirectory()) {
						childrenDirectories.push(itemName);
					}
				} catch (e) {
					/* ignore errors for items we can't stat */
				}
			}
		} else {
			// Use subFolders from appVault.adapter.list()
			for (const folderPath of subFolders) {
				const folderName = path.basename(folderPath);
				if (folderName.startsWith(".")) continue;
				childrenDirectories.push(folderName);
			}
		}
		childrenDirectories.sort();

		let parentDirName: string | undefined = path.dirname(dirPath);
		if (parentDirName === "." || parentDirName === vaultName) {
			parentDirName = "../";
		} else {
			parentDirName = `../${path.basename(parentDirName)}`;
		}
		if (dirPath.split(path.sep).length <= 1 && parentDirName === "../") {
			parentDirName = undefined;
		}

		const finalManifestData: DirectoryManifest = {
			purpose:
				existingManifestData?.purpose ||
				`Manifest for directory: ${path.basename(dirPath)}`,
			type: existingManifestData?.type || "mixed",
			domain: existingManifestData?.domain,
			contents: contents.sort((a, b) => a.name.localeCompare(b.name)),
			children: childrenDirectories,
			parent: parentDirName,
		};

		return new ManifestFile(finalManifestData);
	}
}
