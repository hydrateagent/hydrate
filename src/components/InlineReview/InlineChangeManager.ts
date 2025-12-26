import { App, MarkdownView, TFile } from 'obsidian';
import { diff_match_patch } from 'diff-match-patch';
import {
  PendingChange,
  ReviewSession,
  ReviewResult,
  ReviewEvent,
  ReviewEventCallback,
} from './types';

/**
 * Manages inline review sessions for proposed file changes.
 * Orchestrates the diff computation, change tracking, and final content reconstruction.
 */
export class InlineChangeManager {
  private app: App;
  private session: ReviewSession | null = null;
  // @ts-ignore - diff_match_patch typing issue
  private dmp: diff_match_patch;
  private eventCallbacks: ReviewEventCallback[] = [];

  constructor(app: App) {
    this.app = app;
    this.dmp = new diff_match_patch();
  }

  /**
   * Check if a review session is currently active
   */
  public isActive(): boolean {
    return this.session?.isActive ?? false;
  }

  /**
   * Get the current session (if active)
   */
  public getSession(): ReviewSession | null {
    return this.session;
  }

  /**
   * Get all pending changes
   */
  public getPendingChanges(): PendingChange[] {
    return this.session?.changes.filter((c) => c.status === 'pending') ?? [];
  }

  /**
   * Get count of remaining pending changes
   */
  public getRemainingCount(): number {
    return this.getPendingChanges().length;
  }

  /**
   * Subscribe to review events
   */
  public onEvent(callback: ReviewEventCallback): () => void {
    this.eventCallbacks.push(callback);
    return () => {
      const index = this.eventCallbacks.indexOf(callback);
      if (index > -1) {
        this.eventCallbacks.splice(index, 1);
      }
    };
  }

  private emitEvent(event: ReviewEvent): void {
    this.eventCallbacks.forEach((cb) => cb(event));
  }

  /**
   * Start a new review session
   */
  public async startReview(
    filePath: string,
    originalContent: string,
    proposedContent: string
  ): Promise<boolean> {
    // End any existing session first
    if (this.session?.isActive) {
      await this.cancelReview();
    }

    // Compute the diff and create changes
    const changes = this.computeChanges(originalContent, proposedContent);

    if (changes.length === 0) {
      return false; // No changes to review
    }

    this.session = {
      filePath,
      changes,
      originalContent,
      proposedContent,
      isActive: true,
    };

    return true;
  }

  /**
   * Compute changes between original and proposed content
   */
  private computeChanges(
    originalContent: string,
    proposedContent: string
  ): PendingChange[] {
    const changes: PendingChange[] = [];
    const diffs = this.dmp.diff_main(originalContent, proposedContent);
    this.dmp.diff_cleanupSemantic(diffs);

    let originalPos = 0;
    let changeIndex = 0;

    for (let i = 0; i < diffs.length; i++) {
      const [type, text] = diffs[i];

      if (type === 0) {
        // Equal - no change, advance position
        originalPos += text.length;
      } else if (type === -1) {
        // Deletion
        // Check if next diff is an addition (replacement)
        const nextDiff = diffs[i + 1];
        if (nextDiff && nextDiff[0] === 1) {
          // This is a replacement
          changes.push({
            id: `change-${changeIndex++}`,
            type: 'replacement',
            from: originalPos,
            to: originalPos + text.length,
            originalText: text,
            newText: nextDiff[1],
            status: 'pending',
          });
          originalPos += text.length;
          i++; // Skip the next diff (the addition part)
        } else {
          // Pure deletion
          changes.push({
            id: `change-${changeIndex++}`,
            type: 'deletion',
            from: originalPos,
            to: originalPos + text.length,
            originalText: text,
            newText: '',
            status: 'pending',
          });
          originalPos += text.length;
        }
      } else if (type === 1) {
        // Pure addition (not preceded by deletion)
        changes.push({
          id: `change-${changeIndex++}`,
          type: 'addition',
          from: originalPos,
          to: originalPos,
          originalText: '',
          newText: text,
          status: 'pending',
        });
        // Don't advance originalPos for additions
      }
    }

    return changes;
  }

  /**
   * Accept a specific change by ID
   */
  public acceptChange(changeId: string): void {
    if (!this.session) return;

    const change = this.session.changes.find((c) => c.id === changeId);
    if (change && change.status === 'pending') {
      change.status = 'accepted';
      this.emitEvent({
        type: 'change-accepted',
        changeId,
        remainingCount: this.getRemainingCount(),
      });
      this.checkAutoComplete();
    }
  }

  /**
   * Reject a specific change by ID
   */
  public rejectChange(changeId: string): void {
    if (!this.session) return;

    const change = this.session.changes.find((c) => c.id === changeId);
    if (change && change.status === 'pending') {
      change.status = 'rejected';
      this.emitEvent({
        type: 'change-rejected',
        changeId,
        remainingCount: this.getRemainingCount(),
      });
      this.checkAutoComplete();
    }
  }

  /**
   * Accept all remaining pending changes
   */
  public acceptAllRemaining(): void {
    if (!this.session) return;

    this.session.changes
      .filter((c) => c.status === 'pending')
      .forEach((c) => {
        c.status = 'accepted';
      });

    this.emitEvent({
      type: 'all-accepted',
      remainingCount: 0,
    });

    this.checkAutoComplete();
  }

  /**
   * Reject all remaining pending changes
   */
  public rejectAllRemaining(): void {
    if (!this.session) return;

    this.session.changes
      .filter((c) => c.status === 'pending')
      .forEach((c) => {
        c.status = 'rejected';
      });

    this.emitEvent({
      type: 'all-rejected',
      remainingCount: 0,
    });

    this.checkAutoComplete();
  }

  /**
   * Check if all changes have been processed and auto-complete if so
   */
  private checkAutoComplete(): void {
    if (this.getRemainingCount() === 0) {
      // All changes processed - could auto-finalize here
      // For now, we wait for explicit finalize call
    }
  }

  /**
   * Finalize the review and return the result
   */
  public finalize(): ReviewResult {
    if (!this.session) {
      return {
        applied: false,
        finalContent: '',
        acceptedCount: 0,
        rejectedCount: 0,
        message: 'No active review session',
      };
    }

    const acceptedCount = this.session.changes.filter(
      (c) => c.status === 'accepted'
    ).length;
    const rejectedCount = this.session.changes.filter(
      (c) => c.status === 'rejected'
    ).length;

    // If there are still pending changes, treat them as rejected
    const pendingCount = this.session.changes.filter(
      (c) => c.status === 'pending'
    ).length;

    const finalContent = this.reconstructContent();
    const applied = acceptedCount > 0;

    const result: ReviewResult = {
      applied,
      finalContent,
      acceptedCount,
      rejectedCount: rejectedCount + pendingCount,
      message: this.buildResultMessage(acceptedCount, rejectedCount + pendingCount),
    };

    this.emitEvent({
      type: 'review-complete',
      remainingCount: 0,
    });

    // Clean up session
    this.session.isActive = false;
    this.session = null;

    return result;
  }

  /**
   * Cancel the review without applying any changes
   */
  public async cancelReview(): Promise<ReviewResult> {
    if (!this.session) {
      return {
        applied: false,
        finalContent: '',
        acceptedCount: 0,
        rejectedCount: 0,
        message: 'No active review session',
      };
    }

    const result: ReviewResult = {
      applied: false,
      finalContent: this.session.originalContent,
      acceptedCount: 0,
      rejectedCount: this.session.changes.length,
      message: 'Review cancelled - no changes applied',
    };

    this.emitEvent({
      type: 'review-cancelled',
      remainingCount: 0,
    });

    this.session.isActive = false;
    this.session = null;

    return result;
  }

  /**
   * Reconstruct the final content based on accepted/rejected changes
   */
  private reconstructContent(): string {
    if (!this.session) return '';

    const { originalContent, changes } = this.session;

    // Sort changes by position (descending) to apply from end to start
    // This prevents position shifting issues
    const sortedChanges = [...changes].sort((a, b) => b.from - a.from);

    let result = originalContent;

    for (const change of sortedChanges) {
      if (change.status === 'accepted') {
        // Apply the change
        const before = result.slice(0, change.from);
        const after = result.slice(change.to);
        result = before + change.newText + after;
      }
      // Rejected or pending changes are left as-is (original content)
    }

    return result;
  }

  /**
   * Build a human-readable result message
   */
  private buildResultMessage(accepted: number, rejected: number): string {
    if (accepted === 0) {
      return 'No changes applied';
    }
    if (rejected === 0) {
      return `Applied all ${accepted} change${accepted === 1 ? '' : 's'}`;
    }
    return `Applied ${accepted} of ${accepted + rejected} changes`;
  }

  /**
   * Get a change by its ID
   */
  public getChange(changeId: string): PendingChange | undefined {
    return this.session?.changes.find((c) => c.id === changeId);
  }

  /**
   * Get all changes (for decoration rendering)
   */
  public getAllChanges(): PendingChange[] {
    return this.session?.changes ?? [];
  }

  /**
   * Get the file path being reviewed
   */
  public getFilePath(): string | null {
    return this.session?.filePath ?? null;
  }
}

// Singleton instance for global access
let managerInstance: InlineChangeManager | null = null;

export function getInlineChangeManager(app: App): InlineChangeManager {
  if (!managerInstance) {
    managerInstance = new InlineChangeManager(app);
  }
  return managerInstance;
}

export function resetInlineChangeManager(): void {
  managerInstance = null;
}
