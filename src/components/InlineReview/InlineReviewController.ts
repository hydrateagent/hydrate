import { App, MarkdownView, TFile, Notice, WorkspaceLeaf } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { Extension } from '@codemirror/state';
import HydratePlugin, { REACT_HOST_VIEW_TYPE } from '../../main';
import {
  InlineChangeManager,
  getInlineChangeManager,
} from './InlineChangeManager';
import {
  createInlineReviewExtension,
  setReviewChanges,
  clearReviewChanges,
  setChangesEffect,
} from './ChangeDecorationPlugin';
import { ReviewToolbar, createReviewToolbar } from './ReviewToolbar';
import { ReviewResult, PendingChange } from './types';
import { DiffReviewResult } from '../DiffReviewModal';

/**
 * Controller that orchestrates the inline review experience.
 * Connects the InlineChangeManager, CodeMirror decorations, and toolbar.
 */
export class InlineReviewController {
  private app: App;
  private plugin: HydratePlugin;
  private manager: InlineChangeManager;
  private toolbar: ReviewToolbar | null = null;
  private editorExtension: Extension[];
  private currentView: MarkdownView | null = null;
  private resolvePromise: ((result: DiffReviewResult) => void) | null = null;
  private toolCallId: string = '';
  private eventUnsubscribe: (() => void) | null = null;
  private switchedFromReactView: boolean = false; // Track if we need to switch back
  private reactViewKey: string | null = null; // Store the view key to restore

  constructor(app: App, plugin: HydratePlugin) {
    this.app = app;
    this.plugin = plugin;
    this.manager = getInlineChangeManager(app);
    this.editorExtension = createInlineReviewExtension();
  }

  /**
   * Get the CodeMirror extension to register with the plugin
   */
  public getEditorExtension(): Extension[] {
    return this.editorExtension;
  }

  /**
   * Start an inline review session for proposed file changes.
   * Returns a promise that resolves when the user completes the review.
   */
  public async startReview(
    filePath: string,
    originalContent: string,
    proposedContent: string,
    toolCallId: string
  ): Promise<DiffReviewResult> {
    // Clean up any existing review session first
    this.cleanup();
    this.cleanupOrphanedToolbars();

    // Open the file in editor if not already open
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) {
      return {
        toolCallId,
        applied: false,
        message: `File not found: ${filePath}`,
      };
    }

    // Reset ReactView tracking
    this.switchedFromReactView = false;
    this.reactViewKey = null;

    // Check if file is currently open in a ReactView - if so, switch that leaf to markdown
    let leaf: WorkspaceLeaf | undefined;
    const reactLeaf = this.app.workspace.getLeavesOfType(REACT_HOST_VIEW_TYPE).find((l) => {
      const state = l.getViewState();
      return state.state?.filePath === filePath;
    });

    if (reactLeaf) {
      // File is in ReactView - switch to markdown in the same leaf
      this.switchedFromReactView = true;
      this.reactViewKey = (reactLeaf.getViewState().state as any)?.viewKey || null;

      // Set flag to prevent handleLayoutChange from switching back
      this.plugin.isInlineReviewActive = true;

      await reactLeaf.setViewState({
        type: 'markdown',
        state: { file: filePath },
      });
      leaf = reactLeaf;
    } else {
      // Look for existing markdown view
      leaf = this.app.workspace.getLeavesOfType('markdown').find((l) => {
        const view = l.view as MarkdownView;
        return view.file?.path === filePath;
      });

      if (!leaf) {
        // Open the file in a new leaf
        leaf = this.app.workspace.getLeaf('tab');
        await leaf.setViewState({
          type: 'markdown',
          state: { file: filePath },
        });
      }
    }

    // Wait a tick for the view to initialize
    await new Promise((resolve) => setTimeout(resolve, 50));

    const markdownView = leaf.view as MarkdownView;
    if (!markdownView || markdownView.getViewType() !== 'markdown') {
      this.plugin.isInlineReviewActive = false; // Reset flag on failure
      return {
        toolCallId,
        applied: false,
        message: `Could not open markdown view for: ${filePath}`,
      };
    }

    // Focus the leaf
    this.app.workspace.setActiveLeaf(leaf, { focus: true });

    // Start the review session in the manager
    const hasChanges = await this.manager.startReview(
      filePath,
      originalContent,
      proposedContent
    );

    if (!hasChanges) {
      return {
        toolCallId,
        applied: false,
        message: 'No changes detected',
      };
    }

    this.currentView = markdownView;
    this.toolCallId = toolCallId;

    // Get the CodeMirror EditorView
    const editorView = this.getEditorView(markdownView);
    if (!editorView) {
      return {
        toolCallId,
        applied: false,
        message: 'Could not access editor view',
      };
    }

    // Apply the changes to the editor decorations
    const changes = this.manager.getAllChanges();
    setReviewChanges(editorView, changes);

    // Create and show the toolbar
    this.toolbar = createReviewToolbar(markdownView, {
      onAcceptAll: () => this.handleAcceptAll(),
      onRejectAll: () => this.handleRejectAll(),
      onDone: () => this.handleDone(),
      onJumpToNext: () => this.jumpToNextChange(),
    });
    this.toolbar.updateCount(this.manager.getRemainingCount());
    this.toolbar.show();

    // Add review mode indicator
    markdownView.contentEl.addClass('hydrate-review-mode-active');

    // Subscribe to change events
    this.eventUnsubscribe = this.manager.onEvent((event) => {
      this.toolbar?.updateCount(event.remainingCount);

      // If a change was accepted/rejected via hover widget, update decorations
      if (event.type === 'change-accepted' || event.type === 'change-rejected') {
        const editorView = this.getEditorView(this.currentView!);
        if (editorView && event.changeId) {
          const change = this.manager.getChange(event.changeId);
          if (change) {
            // The decoration plugin already handles this via effects
          }
        }
      }
    });

    // Set up custom event listeners for hover widget interactions
    markdownView.contentEl.addEventListener(
      'hydrate-change-accepted',
      this.handleChangeAccepted as EventListener
    );
    markdownView.contentEl.addEventListener(
      'hydrate-change-rejected',
      this.handleChangeRejected as EventListener
    );

    // Return a promise that resolves when review is complete
    return new Promise<DiffReviewResult>((resolve) => {
      this.resolvePromise = resolve;
    });
  }

  /**
   * Get the CodeMirror EditorView from a MarkdownView
   */
  private getEditorView(markdownView: MarkdownView): EditorView | null {
    // Access the CodeMirror editor through Obsidian's internals
    // This uses the standard approach for accessing CM6 in Obsidian
    const editor = markdownView.editor;
    if (!editor) return null;

    // The CM6 EditorView is available on the editor object
    // @ts-ignore - Obsidian doesn't expose this in types
    return (editor as any).cm as EditorView | undefined ?? null;
  }

  /**
   * Handle hover widget accept event
   */
  private handleChangeAccepted = (event: CustomEvent) => {
    const { changeId } = event.detail;
    this.manager.acceptChange(changeId);
  };

  /**
   * Handle hover widget reject event
   */
  private handleChangeRejected = (event: CustomEvent) => {
    const { changeId } = event.detail;
    this.manager.rejectChange(changeId);
  };

  /**
   * Handle Accept All button click
   */
  private handleAcceptAll(): void {
    this.manager.acceptAllRemaining();

    // Update decorations
    const editorView = this.getEditorView(this.currentView!);
    if (editorView) {
      setReviewChanges(editorView, this.manager.getAllChanges());
    }
  }

  /**
   * Handle Reject All button click
   */
  private handleRejectAll(): void {
    this.manager.rejectAllRemaining();

    // Update decorations
    const editorView = this.getEditorView(this.currentView!);
    if (editorView) {
      setReviewChanges(editorView, this.manager.getAllChanges());
    }
  }

  /**
   * Handle Done button click - finalize the review
   */
  private async handleDone(): Promise<void> {
    const result = this.manager.finalize();
    await this.completeReview(result);
  }

  /**
   * Jump to the next pending change in the document
   */
  private jumpToNextChange(): void {
    const pendingChanges = this.manager.getPendingChanges();
    if (pendingChanges.length === 0) {
      new Notice('No more changes to review');
      return;
    }

    const editorView = this.getEditorView(this.currentView!);
    if (!editorView) return;

    // Find the first pending change
    const firstChange = pendingChanges[0];

    // Scroll to that position
    editorView.dispatch({
      effects: EditorView.scrollIntoView(firstChange.from, { y: 'center' }),
    });
  }

  /**
   * Complete the review and clean up
   */
  private async completeReview(result: ReviewResult): Promise<void> {
    const filePath = this.currentView?.file?.path;
    const shouldSwitchBack = this.switchedFromReactView && this.reactViewKey && filePath;

    // Write the final content to the file if changes were applied
    if (result.applied && this.currentView?.file) {
      try {
        await this.app.vault.modify(this.currentView.file, result.finalContent);
      } catch (error) {
        console.error('Failed to write file:', error);
        new Notice('Failed to save changes');
      }
    }

    // Get the leaf before cleanup (cleanup clears currentView)
    // Find the leaf that contains our current markdown view
    const leaf = this.currentView
      ? this.app.workspace.getLeavesOfType('markdown').find(l => l.view === this.currentView)
      : null;

    // Clean up UI
    this.cleanup();

    // Switch back to ReactView if we came from one
    if (shouldSwitchBack && leaf) {
      try {
        await leaf.setViewState({
          type: REACT_HOST_VIEW_TYPE,
          state: { filePath, viewKey: this.reactViewKey },
        });
      } catch (error) {
        console.error('Failed to switch back to ReactView:', error);
      }
    }

    // Reset the flag after switching back
    this.plugin.isInlineReviewActive = false;
    this.switchedFromReactView = false;
    this.reactViewKey = null;

    // Resolve the promise with the result
    if (this.resolvePromise) {
      this.resolvePromise({
        toolCallId: this.toolCallId,
        applied: result.applied,
        finalContent: result.finalContent,
        message: result.message,
      });
      this.resolvePromise = null;
    }

    // Show notification
    new Notice(result.message);
  }

  /**
   * Cancel the review (e.g., if user navigates away)
   */
  public async cancel(): Promise<void> {
    const result = await this.manager.cancelReview();
    await this.completeReview(result);
  }

  /**
   * Check if a review is currently active
   */
  public isActive(): boolean {
    return this.manager.isActive();
  }

  /**
   * Clean up all review UI elements
   */
  private cleanup(): void {
    // Remove event listeners
    if (this.currentView) {
      this.currentView.contentEl.removeEventListener(
        'hydrate-change-accepted',
        this.handleChangeAccepted as EventListener
      );
      this.currentView.contentEl.removeEventListener(
        'hydrate-change-rejected',
        this.handleChangeRejected as EventListener
      );
      this.currentView.contentEl.removeClass('hydrate-review-mode-active');
    }

    // Clear decorations
    if (this.currentView) {
      const editorView = this.getEditorView(this.currentView);
      if (editorView) {
        clearReviewChanges(editorView);
      }
    }

    // Hide and destroy toolbar
    if (this.toolbar) {
      this.toolbar.destroy();
      this.toolbar = null;
    }

    // Unsubscribe from events
    if (this.eventUnsubscribe) {
      this.eventUnsubscribe();
      this.eventUnsubscribe = null;
    }

    this.currentView = null;
  }

  /**
   * Clean up any orphaned toolbars that may have been left in the DOM
   */
  private cleanupOrphanedToolbars(): void {
    document.querySelectorAll('.hydrate-review-toolbar').forEach((el) => {
      el.remove();
    });
    // Also remove any review mode indicators
    document.querySelectorAll('.hydrate-review-mode-active').forEach((el) => {
      el.classList.remove('hydrate-review-mode-active');
    });
  }

  /**
   * Destroy the controller and clean up resources
   */
  public destroy(): void {
    if (this.isActive()) {
      this.cancel();
    }
    this.cleanupOrphanedToolbars();
  }
}

// Singleton instance
let controllerInstance: InlineReviewController | null = null;

export function getInlineReviewController(
  app: App,
  plugin: HydratePlugin
): InlineReviewController {
  if (!controllerInstance) {
    controllerInstance = new InlineReviewController(app, plugin);
  }
  return controllerInstance;
}

export function resetInlineReviewController(): void {
  if (controllerInstance) {
    controllerInstance.destroy();
    controllerInstance = null;
  }
}
