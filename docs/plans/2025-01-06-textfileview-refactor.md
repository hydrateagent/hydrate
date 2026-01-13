# ReactViewHost TextFileView Refactor - Design Document

> Created: 2025-01-06
> Status: Draft

## Overview

Refactor `ReactViewHost` to extend Obsidian's `TextFileView` instead of `ItemView`. This simplifies file handling by leveraging built-in functionality for reading, writing, dirty-state tracking, and external change detection.

## Current State

`ReactViewHost` extends `ItemView` and manually handles all file operations:

```typescript
class ReactViewHost extends ItemView {
  // Manual file reading
  async mountReactComponent() {
    this.currentMarkdownContent = await this.app.vault.read(file);
  }

  // Manual file writing
  updateMarkdownContent = async (newContent: string) => {
    await this.app.vault.process(file, () => newContent);
  }

  // Manual change detection
  private handleVaultModify = async (file: TAbstractFile) => {
    if (file.path === this.currentFilePath) {
      const newContent = await this.app.vault.read(file);
      if (newContent !== this.currentMarkdownContent) {
        await this.mountReactComponent();
      }
    }
  }
}
```

### Current Pain Points

1. **No dirty-state tracking** - No "unsaved changes" indicator or save-on-close prompt
2. **Manual event wiring** - Must register/unregister `vault.on("modify")` listeners
3. **Race conditions** - Potential conflicts between external edits and in-flight saves
4. **Duplicated logic** - File I/O patterns that `TextFileView` handles automatically

## Proposed State

Extend `TextFileView` which provides:

| Feature | Current (manual) | With `TextFileView` |
|---------|------------------|---------------------|
| Read file on open | `vault.read()` | Built-in via `onLoadFile()` |
| Write file | `vault.process()` | Built-in via `requestSave()` |
| Dirty state tracking | Not implemented | Built-in (`data` property) |
| Save on close prompt | Not implemented | Built-in |
| External change detection | Manual `vault.on("modify")` | Built-in |

## Technical Architecture

### New Class Structure

```typescript
import { TextFileView, TFile, WorkspaceLeaf } from "obsidian";

export class ReactViewHost extends TextFileView {
  plugin: HydratePlugin;
  currentViewKey: string | null = null;
  private reactRoot: Root | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: HydratePlugin) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = true;
    this.containerEl.addClass("hydrate-react-host-container");
  }

  // Required: Return current content for saving
  getViewData(): string {
    return this.data;
  }

  // Required: Called when file is loaded or externally modified
  setViewData(data: string, clear: boolean): void {
    this.data = data;
    if (clear) {
      this.clear();
    }
    this.mountReactComponent();
  }

  // Required: Reset view state
  clear(): void {
    this.unmountReactComponent();
    this.data = "";
  }

  // Return file extensions this view handles
  getViewType(): string {
    return REACT_HOST_VIEW_TYPE;
  }

  canAcceptExtension(extension: string): boolean {
    return extension === "md";
  }
}
```

### Key Changes

#### 1. File Reading (Simplified)

**Before:**
```typescript
async mountReactComponent(): Promise<void> {
  const file = this.app.vault.getAbstractFileByPath(this.currentFilePath);
  this.currentMarkdownContent = await this.app.vault.read(file);
  // ... render
}
```

**After:**
```typescript
// TextFileView calls setViewData() automatically when file loads
setViewData(data: string, clear: boolean): void {
  this.mountReactComponent(); // this.data already contains file content
}
```

#### 2. File Writing (Simplified)

**Before:**
```typescript
updateMarkdownContent = async (newContent: string): Promise<boolean> => {
  const file = this.app.vault.getAbstractFileByPath(this.currentFilePath);
  await this.app.vault.process(file, () => {
    this.currentMarkdownContent = newContent;
    return newContent;
  });
  return true;
}
```

**After:**
```typescript
updateMarkdownContent = async (newContent: string): Promise<boolean> => {
  this.data = newContent;      // Update internal state
  this.requestSave();          // TextFileView handles the write
  return true;
}
```

#### 3. External Change Detection (Removed)

**Before:**
```typescript
async onOpen(): Promise<void> {
  this.registerEvent(this.app.vault.on("modify", this.handleVaultModify));
}

private handleVaultModify = async (file: TAbstractFile): Promise<void> => {
  if (file.path === this.currentFilePath) {
    const newContent = await this.app.vault.read(file);
    if (newContent !== this.currentMarkdownContent) {
      await this.mountReactComponent();
    }
  }
}
```

**After:**
```typescript
// TextFileView automatically calls setViewData() on external changes
// No manual event handling needed
```

#### 4. Props Passed to React Components

The `ReactViewProps` interface remains the same, but the implementation simplifies:

```typescript
private mountReactComponent(): void {
  const props: ReactViewProps = {
    app: this.app,
    plugin: this.plugin,
    filePath: this.file?.path ?? "",
    markdownContent: this.data,  // Use TextFileView's data property
    updateMarkdownContent: this.updateMarkdownContent,
    switchToMarkdownView: this.switchToMarkdownView,
  };
  // ... render
}
```

### State Management

`TextFileView` uses `this.file` and `this.data` instead of our manual tracking:

| Current Property | TextFileView Equivalent |
|------------------|------------------------|
| `this.currentFilePath` | `this.file?.path` |
| `this.currentMarkdownContent` | `this.data` |

### View Key Handling

The view key (which React component to render) needs special handling since `TextFileView` doesn't know about it:

```typescript
interface ReactViewHostState {
  viewKey?: string | null;
  refreshToken?: number;
}

getState(): ReactViewHostState {
  return {
    ...super.getState(),
    viewKey: this.currentViewKey,
    refreshToken: this.currentRefreshToken,
  };
}

async setState(state: ReactViewHostState, result: ViewStateResult): Promise<void> {
  this.currentViewKey = state.viewKey ?? null;
  this.currentRefreshToken = state.refreshToken ?? 0;
  await super.setState(state, result);
}
```

## Migration Steps

### Phase 1: Extend TextFileView

- [ ] Change `extends ItemView` to `extends TextFileView`
- [ ] Implement required methods: `getViewData()`, `setViewData()`, `clear()`
- [ ] Remove manual file reading in `mountReactComponent()`
- [ ] Update `updateMarkdownContent()` to use `requestSave()`

### Phase 2: Remove Manual Event Handling

- [ ] Remove `vault.on("modify")` registration
- [ ] Remove `handleVaultModify()` method
- [ ] Remove `currentMarkdownContent` property (use `this.data`)
- [ ] Remove `currentFilePath` property (use `this.file?.path`)

### Phase 3: Update State Management

- [ ] Update `getState()` to work with TextFileView state
- [ ] Update `setState()` to preserve view key handling
- [ ] Test navigation history (back/forward)

### Phase 4: Test Edge Cases

- [ ] External file modifications reload correctly
- [ ] Dirty state indicator appears when content changes
- [ ] Save prompt appears on close with unsaved changes
- [ ] Hot reload still works for view code changes
- [ ] Switch to markdown view still works
- [ ] Multiple files with same view type work correctly

## Risks & Mitigations

### Risk: TextFileView assumptions don't match our use case

`TextFileView` is designed for text editors. Our React views might have different save patterns.

**Mitigation:** Test thoroughly. If needed, we can override `save()` or `requestSave()` to customize behavior.

### Risk: View key state lost during navigation

`TextFileView` manages file state, but we also need to track which React component to render.

**Mitigation:** Keep `currentViewKey` as a separate property and persist it in `getState()`/`setState()`.

### Risk: Hot reload behavior changes

Currently we detect view code changes via `refreshToken`. Need to ensure this still works.

**Mitigation:** `refreshToken` is handled in `setState()`, independent of file content. Should still work.

## Code Diff (Conceptual)

```diff
-import { ItemView, WorkspaceLeaf, TFile, TAbstractFile } from "obsidian";
+import { TextFileView, WorkspaceLeaf, TFile } from "obsidian";

-export class ReactViewHost extends ItemView {
+export class ReactViewHost extends TextFileView {
   plugin: HydratePlugin;
-  currentFilePath: string | null = null;
   currentViewKey: string | null = null;
   private currentRefreshToken: number = 0;
   private reactRoot: Root | null = null;
-  private currentMarkdownContent: string | null = null;

+  // Required by TextFileView
+  getViewData(): string {
+    return this.data;
+  }
+
+  setViewData(data: string, clear: boolean): void {
+    if (clear) {
+      this.clear();
+    }
+    this.mountReactComponent();
+  }
+
+  clear(): void {
+    this.unmountReactComponent();
+  }

   async onOpen(): Promise<void> {
-    this.registerEvent(this.app.vault.on("modify", this.handleVaultModify));
     this.addAction("document", "Switch to Markdown view", this.switchToMarkdownView);
-    if (this.currentFilePath && this.currentViewKey && !this.reactRoot) {
+    if (this.file && this.currentViewKey && !this.reactRoot) {
       await this.mountReactComponent();
     }
   }

   private async mountReactComponent(): Promise<void> {
-    if (!this.currentFilePath || !this.currentViewKey) {
+    if (!this.file || !this.currentViewKey) {
       return;
     }

-    const file = this.app.vault.getAbstractFileByPath(this.currentFilePath);
-    this.currentMarkdownContent = await this.app.vault.read(file);

     const props: ReactViewProps = {
       app: this.app,
       plugin: this.plugin,
-      filePath: this.currentFilePath,
-      markdownContent: this.currentMarkdownContent,
+      filePath: this.file.path,
+      markdownContent: this.data,
       updateMarkdownContent: this.updateMarkdownContent,
       switchToMarkdownView: this.switchToMarkdownView,
     };
     // ... render
   }

   updateMarkdownContent = async (newContent: string): Promise<boolean> => {
-    const file = this.app.vault.getAbstractFileByPath(this.currentFilePath);
-    await this.app.vault.process(file, () => {
-      this.currentMarkdownContent = newContent;
-      return newContent;
-    });
+    this.data = newContent;
+    this.requestSave();
     return true;
   }

-  private handleVaultModify = async (file: TAbstractFile): Promise<void> => {
-    if (file instanceof TFile && file.path === this.currentFilePath) {
-      const newContent = await this.app.vault.read(file);
-      if (newContent !== this.currentMarkdownContent) {
-        this.currentMarkdownContent = newContent;
-        await this.mountReactComponent();
-      }
-    }
-  }
 }
```

## Success Criteria

1. **Functional parity** - All current features still work
2. **Dirty state** - Unsaved changes indicator visible in tab
3. **Save prompt** - Closing with unsaved changes prompts user
4. **External edits** - File changes from other sources trigger reload
5. **Less code** - ~50 lines removed from ReactViewHost
6. **No regressions** - Hot reload, view switching, navigation all work
