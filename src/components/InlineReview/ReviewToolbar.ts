import { MarkdownView } from 'obsidian';

export interface ReviewToolbarCallbacks {
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onDone: () => void;
  onJumpToNext: () => void;
}

/**
 * Floating toolbar for review mode with bulk actions
 */
export class ReviewToolbar {
  private containerEl: HTMLElement;
  private countEl: HTMLElement;
  private callbacks: ReviewToolbarCallbacks;
  private isVisible: boolean = false;

  constructor(
    parentEl: HTMLElement,
    callbacks: ReviewToolbarCallbacks
  ) {
    this.callbacks = callbacks;
    this.containerEl = this.createToolbar(parentEl);
  }

  private createToolbar(parentEl: HTMLElement): HTMLElement {
    const toolbar = document.createElement('div');
    toolbar.className = 'hydrate-review-toolbar';

    // Make it draggable
    toolbar.draggable = true;
    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;

    toolbar.addEventListener('dragstart', (e) => {
      isDragging = true;
      offsetX = e.clientX - toolbar.getBoundingClientRect().left;
      offsetY = e.clientY - toolbar.getBoundingClientRect().top;
      // Use a transparent drag image
      const img = new Image();
      img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      e.dataTransfer?.setDragImage(img, 0, 0);
    });

    toolbar.addEventListener('drag', (e) => {
      if (isDragging && e.clientX > 0 && e.clientY > 0) {
        toolbar.style.left = `${e.clientX - offsetX}px`;
        toolbar.style.top = `${e.clientY - offsetY}px`;
        toolbar.style.right = 'auto';
        toolbar.style.bottom = 'auto';
      }
    });

    toolbar.addEventListener('dragend', () => {
      isDragging = false;
    });

    // Header with count
    const header = document.createElement('div');
    header.className = 'hydrate-review-toolbar-header';

    this.countEl = document.createElement('span');
    this.countEl.className = 'hydrate-review-toolbar-count';
    this.countEl.textContent = '0 changes remaining';
    header.appendChild(this.countEl);

    // Jump to next button
    const jumpBtn = document.createElement('button');
    jumpBtn.className = 'hydrate-review-toolbar-btn hydrate-review-jump';
    jumpBtn.innerHTML = '&#8595;'; // Down arrow
    jumpBtn.title = 'Jump to next change';
    jumpBtn.onclick = () => this.callbacks.onJumpToNext();
    header.appendChild(jumpBtn);

    toolbar.appendChild(header);

    // Button container
    const buttons = document.createElement('div');
    buttons.className = 'hydrate-review-toolbar-buttons';

    const acceptAllBtn = document.createElement('button');
    acceptAllBtn.className = 'hydrate-review-toolbar-btn hydrate-review-accept-all';
    acceptAllBtn.textContent = 'Accept All';
    acceptAllBtn.onclick = () => this.callbacks.onAcceptAll();

    const rejectAllBtn = document.createElement('button');
    rejectAllBtn.className = 'hydrate-review-toolbar-btn hydrate-review-reject-all';
    rejectAllBtn.textContent = 'Reject All';
    rejectAllBtn.onclick = () => this.callbacks.onRejectAll();

    const doneBtn = document.createElement('button');
    doneBtn.className = 'hydrate-review-toolbar-btn hydrate-review-done';
    doneBtn.textContent = 'Done';
    doneBtn.onclick = () => this.callbacks.onDone();

    buttons.appendChild(acceptAllBtn);
    buttons.appendChild(rejectAllBtn);
    buttons.appendChild(doneBtn);
    toolbar.appendChild(buttons);

    // Add to parent (hidden initially)
    toolbar.style.display = 'none';
    parentEl.appendChild(toolbar);

    return toolbar;
  }

  /**
   * Update the change count display
   */
  public updateCount(remaining: number): void {
    const text = remaining === 1
      ? '1 change remaining'
      : `${remaining} changes remaining`;
    this.countEl.textContent = text;

    // If no changes remaining, update UI
    if (remaining === 0) {
      this.countEl.textContent = 'All changes reviewed';
    }
  }

  /**
   * Show the toolbar
   */
  public show(): void {
    this.containerEl.style.display = 'block';
    this.isVisible = true;
  }

  /**
   * Hide the toolbar
   */
  public hide(): void {
    this.containerEl.style.display = 'none';
    this.isVisible = false;
  }

  /**
   * Check if toolbar is visible
   */
  public isShowing(): boolean {
    return this.isVisible;
  }

  /**
   * Destroy the toolbar and clean up
   */
  public destroy(): void {
    this.containerEl.remove();
  }

  /**
   * Reset position to default (bottom-right)
   */
  public resetPosition(): void {
    this.containerEl.style.left = 'auto';
    this.containerEl.style.top = 'auto';
    this.containerEl.style.right = '16px';
    this.containerEl.style.bottom = '16px';
  }
}

/**
 * Create a review toolbar attached to a MarkdownView
 */
export function createReviewToolbar(
  view: MarkdownView,
  callbacks: ReviewToolbarCallbacks
): ReviewToolbar {
  // Get the content container of the markdown view
  const contentEl = view.contentEl;
  return new ReviewToolbar(contentEl, callbacks);
}
