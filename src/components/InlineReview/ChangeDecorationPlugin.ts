import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { StateField, StateEffect, RangeSetBuilder } from '@codemirror/state';
import { PendingChange } from './types';

/**
 * State effect to update the changes being displayed
 */
export const setChangesEffect = StateEffect.define<PendingChange[]>();

/**
 * State effect to update a single change's status
 */
export const updateChangeStatusEffect = StateEffect.define<{
  changeId: string;
  status: 'pending' | 'accepted' | 'rejected';
}>();

/**
 * State effect to clear all decorations
 */
export const clearChangesEffect = StateEffect.define<void>();

/**
 * Widget for showing the "new text" in replacements
 */
class AdditionWidget extends WidgetType {
  constructor(private text: string, private changeId: string) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'hydrate-review-addition';
    span.textContent = this.text;
    span.dataset.changeId = this.changeId;
    return span;
  }

  eq(other: AdditionWidget): boolean {
    return other.text === this.text && other.changeId === this.changeId;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * State field that tracks the changes and provides decorations
 */
export const changeDecorationField = StateField.define<{
  changes: PendingChange[];
  decorations: DecorationSet;
}>({
  create() {
    return {
      changes: [],
      decorations: Decoration.none,
    };
  },

  update(value, tr) {
    let changes = value.changes;
    let needsRebuild = false;

    for (const effect of tr.effects) {
      if (effect.is(setChangesEffect)) {
        changes = effect.value;
        needsRebuild = true;
      } else if (effect.is(updateChangeStatusEffect)) {
        const { changeId, status } = effect.value;
        changes = changes.map((c) =>
          c.id === changeId ? { ...c, status } : c
        );
        needsRebuild = true;
      } else if (effect.is(clearChangesEffect)) {
        return {
          changes: [],
          decorations: Decoration.none,
        };
      }
    }

    // If document changed, we need to map positions
    // For now, we don't support editing during review (v1)
    if (tr.docChanged) {
      // Document changed - this shouldn't happen in review mode
      // but if it does, clear decorations to be safe
      return {
        changes: [],
        decorations: Decoration.none,
      };
    }

    if (needsRebuild) {
      const decorations = buildDecorations(changes, tr.state.doc.length);
      return { changes, decorations };
    }

    return value;
  },

  provide(field) {
    return EditorView.decorations.from(field, (value) => value.decorations);
  },
});

/**
 * Build decorations from the list of changes
 */
function buildDecorations(
  changes: PendingChange[],
  docLength: number
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  // Sort changes by position for proper decoration building
  const sortedChanges = [...changes].sort((a, b) => a.from - b.from);

  for (const change of sortedChanges) {
    // Skip changes that are outside document bounds
    if (change.from > docLength || change.to > docLength) {
      continue;
    }

    // Skip accepted/rejected changes - they're no longer visible
    // Actually, we want to show them differently
    const statusClass = getStatusClass(change.status);

    if (change.type === 'deletion') {
      // Mark the deleted text with strikethrough
      if (change.from < change.to) {
        builder.add(
          change.from,
          change.to,
          Decoration.mark({
            class: `hydrate-review-deletion ${statusClass}`,
            attributes: {
              'data-change-id': change.id,
              'data-change-type': 'deletion',
            },
          })
        );
      }
    } else if (change.type === 'addition') {
      // Insert a widget showing the new text
      builder.add(
        change.from,
        change.from,
        Decoration.widget({
          widget: new AdditionWidget(change.newText, change.id),
          side: 1,
        })
      );
    } else if (change.type === 'replacement') {
      // Mark original text as deletion
      if (change.from < change.to) {
        builder.add(
          change.from,
          change.to,
          Decoration.mark({
            class: `hydrate-review-deletion ${statusClass}`,
            attributes: {
              'data-change-id': change.id,
              'data-change-type': 'replacement-old',
            },
          })
        );
      }
      // Add widget for new text after the old text
      builder.add(
        change.to,
        change.to,
        Decoration.widget({
          widget: new AdditionWidget(change.newText, change.id),
          side: 1,
        })
      );
    }
  }

  return builder.finish();
}

/**
 * Get CSS class based on change status
 */
function getStatusClass(status: 'pending' | 'accepted' | 'rejected'): string {
  switch (status) {
    case 'accepted':
      return 'hydrate-review-accepted';
    case 'rejected':
      return 'hydrate-review-rejected';
    default:
      return 'hydrate-review-pending';
  }
}

/**
 * View plugin to handle hover and click interactions on changes.
 *
 * UX Flow:
 * 1. Hover over a change -> buttons appear (for discoverability)
 * 2. Click on a change -> change is "selected", buttons are locked in place
 * 3. Click elsewhere or act -> deselect, buttons disappear
 */
export const changeHoverPlugin = ViewPlugin.fromClass(
  class {
    private hoverWidget: HTMLElement | null = null;
    private hoveredChangeId: string | null = null;
    private selectedChangeId: string | null = null; // Locked selection
    private selectedChangeEl: HTMLElement | null = null;
    private view: EditorView;

    constructor(view: EditorView) {
      this.view = view;
      this.setupEventListeners();
    }

    private setupEventListeners() {
      this.view.dom.addEventListener('mouseover', this.handleMouseOver);
      this.view.dom.addEventListener('mouseout', this.handleMouseOut);
      this.view.dom.addEventListener('click', this.handleClick);
      // Listen for clicks outside the editor to deselect
      document.addEventListener('click', this.handleDocumentClick);
    }

    private handleMouseOver = (event: MouseEvent) => {
      // If a change is selected (locked), don't respond to hover
      if (this.selectedChangeId) {
        return;
      }

      const target = event.target as HTMLElement;
      const changeEl = target.closest('[data-change-id]') as HTMLElement;

      if (changeEl) {
        const changeId = changeEl.dataset.changeId;
        if (changeId && changeId !== this.hoveredChangeId) {
          this.showWidget(changeEl, changeId, false);
        }
      }
    };

    private handleMouseOut = (event: MouseEvent) => {
      // If a change is selected (locked), don't hide on mouseout
      if (this.selectedChangeId) {
        return;
      }

      const relatedTarget = event.relatedTarget as HTMLElement;

      // Check if we're moving to the hover widget itself
      if (this.hoverWidget?.contains(relatedTarget)) {
        return;
      }

      // Check if we're still within the same change element
      const changeEl = relatedTarget?.closest('[data-change-id]') as HTMLElement;
      if (!changeEl || changeEl.dataset.changeId !== this.hoveredChangeId) {
        this.hideWidget();
      }
    };

    private handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      // If clicking on the widget buttons, let them handle it
      if (this.hoverWidget?.contains(target)) {
        return;
      }

      const changeEl = target.closest('[data-change-id]') as HTMLElement;

      if (changeEl) {
        const changeId = changeEl.dataset.changeId;
        if (changeId) {
          // If clicking on a different change, switch selection
          if (changeId !== this.selectedChangeId) {
            this.selectChange(changeEl, changeId);
          }
          // If clicking on the same change, keep it selected
          event.stopPropagation();
        }
      } else {
        // Clicked outside any change - deselect
        this.deselectChange();
      }
    };

    private handleDocumentClick = (event: MouseEvent) => {
      // If click is outside the editor, deselect
      if (!this.view.dom.contains(event.target as Node)) {
        this.deselectChange();
      }
    };

    private selectChange(changeEl: HTMLElement, changeId: string) {
      this.selectedChangeId = changeId;
      this.selectedChangeEl = changeEl;
      // Show widget in "selected" mode (locked)
      this.showWidget(changeEl, changeId, true);
      // Add visual indicator that this change is selected
      changeEl.classList.add('hydrate-review-selected');
    }

    private deselectChange() {
      if (this.selectedChangeEl) {
        this.selectedChangeEl.classList.remove('hydrate-review-selected');
      }
      this.selectedChangeId = null;
      this.selectedChangeEl = null;
      this.hideWidget();
    }

    private showWidget(changeEl: HTMLElement, changeId: string, isSelected: boolean) {
      // Remove any existing widgets (including orphaned ones)
      this.cleanupAllWidgets();
      this.hoveredChangeId = changeId;

      // Create the widget
      this.hoverWidget = document.createElement('div');
      this.hoverWidget.className = 'hydrate-review-hover-widget';
      if (isSelected) {
        this.hoverWidget.classList.add('hydrate-review-widget-selected');
      }

      const acceptBtn = document.createElement('button');
      acceptBtn.className = 'hydrate-review-btn hydrate-review-accept';
      acceptBtn.innerHTML = '&#x2713;'; // Checkmark
      acceptBtn.title = 'Accept this change';
      acceptBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.acceptChange(changeId);
      };

      const rejectBtn = document.createElement('button');
      rejectBtn.className = 'hydrate-review-btn hydrate-review-reject';
      rejectBtn.innerHTML = '&#x2717;'; // X mark
      rejectBtn.title = 'Reject this change';
      rejectBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.rejectChange(changeId);
      };

      this.hoverWidget.appendChild(acceptBtn);
      this.hoverWidget.appendChild(rejectBtn);

      // Position the widget below the change element
      const rect = changeEl.getBoundingClientRect();
      const editorRect = this.view.dom.getBoundingClientRect();

      this.hoverWidget.style.position = 'absolute';
      this.hoverWidget.style.left = `${rect.left - editorRect.left}px`;
      this.hoverWidget.style.top = `${rect.bottom - editorRect.top + 2}px`;

      this.view.dom.appendChild(this.hoverWidget);

      // Only add mouseleave handler if not selected (hover mode)
      if (!isSelected) {
        this.hoverWidget.addEventListener('mouseleave', () => {
          if (!this.selectedChangeId) {
            this.hideWidget();
          }
        });
      }
    }

    private hideWidget() {
      if (this.hoverWidget) {
        this.hoverWidget.remove();
        this.hoverWidget = null;
        this.hoveredChangeId = null;
      }
    }

    private cleanupAllWidgets() {
      // Remove the tracked widget
      if (this.hoverWidget) {
        this.hoverWidget.remove();
        this.hoverWidget = null;
      }
      this.hoveredChangeId = null;

      // Also remove any orphaned widgets from the DOM
      this.view.dom.querySelectorAll('.hydrate-review-hover-widget').forEach((el) => {
        el.remove();
      });
    }

    private acceptChange(changeId: string) {
      // Dispatch an effect to update the change status
      this.view.dispatch({
        effects: updateChangeStatusEffect.of({ changeId, status: 'accepted' }),
      });

      // Clear selection and hide widget
      this.deselectChange();

      // Dispatch a custom event for the manager to handle
      this.view.dom.dispatchEvent(
        new CustomEvent('hydrate-change-accepted', {
          detail: { changeId },
          bubbles: true,
        })
      );
    }

    private rejectChange(changeId: string) {
      this.view.dispatch({
        effects: updateChangeStatusEffect.of({ changeId, status: 'rejected' }),
      });

      // Clear selection and hide widget
      this.deselectChange();

      // Dispatch a custom event for the manager to handle
      this.view.dom.dispatchEvent(
        new CustomEvent('hydrate-change-rejected', {
          detail: { changeId },
          bubbles: true,
        })
      );
    }

    update(update: ViewUpdate) {
      // If decorations changed, we might need to hide the widget
      if (update.docChanged) {
        this.deselectChange();
      }
    }

    destroy() {
      this.deselectChange();
      this.view.dom.removeEventListener('mouseover', this.handleMouseOver);
      this.view.dom.removeEventListener('mouseout', this.handleMouseOut);
      this.view.dom.removeEventListener('click', this.handleClick);
      document.removeEventListener('click', this.handleDocumentClick);
    }
  }
);

/**
 * Create the editor extension for inline review
 */
export function createInlineReviewExtension() {
  return [changeDecorationField, changeHoverPlugin];
}

/**
 * Helper function to set changes in an EditorView
 */
export function setReviewChanges(
  view: EditorView,
  changes: PendingChange[]
): void {
  view.dispatch({
    effects: setChangesEffect.of(changes),
  });
}

/**
 * Helper function to clear all review decorations
 */
export function clearReviewChanges(view: EditorView): void {
  view.dispatch({
    effects: clearChangesEffect.of(undefined),
  });
}
