# Inline Track Changes Design

> Created: 2025-12-26
> Status: Approved
> Replaces: DiffReviewModal

## Overview

Replace the current modal-based diff review (`DiffReviewModal`) with an inline "Review Mode" that renders proposed changes directly in the note editor using CodeMirror decorations. This provides a track-changes experience similar to Word/Google Docs.

## Problem Statement

The current `DiffReviewModal` has several UX issues:
- **Intrusive**: Full-screen modal blocks view of the document
- **Loss of context**: Can't see surrounding content while reviewing
- **Difficult to parse**: Raw `+/-` diff format with git-style headers (`@@ -1,5 +1,6 @@`)
- **Clunky interaction**: Checkbox-based hunk selection feels technical, not natural

## Solution

Render changes inline in the editor with:
- Strikethrough + red background for deletions
- Green background for additions
- Hover-based accept/reject buttons per change
- Floating toolbar for bulk actions

## User Flow

1. **AI returns edit tool call** → Note switches to "Review Mode"

2. **Review Mode activates:**
   - Note remains fully visible and scrollable
   - Deletions: strikethrough with soft red background
   - Additions: soft green background
   - Floating toolbar appears (bottom-right)

3. **User reviews changes:**
   - Hover over any change → accept/reject buttons appear inline
   - Click to accept or reject individual changes
   - Or use toolbar for bulk actions

4. **User finalizes:**
   - "Accept All Remaining" → applies all pending changes
   - "Reject All" → reverts to original
   - "Done" → finalizes mixed result

5. **Review Mode deactivates:**
   - Decorations removed
   - Note returns to normal editing
   - Result sent back to AI conversation

## Visual Design

### Inline Change Rendering

```
The quick brown fox jumps over the ░lazy░ ▓sleepy▓ dog.
                                     ^^^    ^^^^^^^
                                   deletion  addition
```

- **Deletions**: Strikethrough + `bg-red-100/50` (light) / `bg-red-900/30` (dark)
- **Additions**: `bg-green-100/50` (light) / `bg-green-900/30` (dark)
- **Replacements**: Show as `~~old~~ new` side-by-side

### Hover Controls

When hovering over a change:

```
The quick brown fox jumps over the ░lazy░ ▓sleepy▓ dog.
                                          [✓][✗]
```

- `✓` (checkmark) = Accept this change
- `✗` (x) = Reject this change
- Small buttons (16px), positioned below/beside the change

### Floating Toolbar

Fixed position, bottom-right of editor pane:

```
┌─────────────────────────────────────┐
│ 3 changes remaining                 │
│ [Accept All] [Reject All] [Done]    │
└─────────────────────────────────────┘
```

- Shows count of pending changes
- Semi-transparent background
- Draggable to reposition
- "Jump to next change" button for long documents

## Technical Architecture

### Components

1. **`InlineChangeManager`**
   - Orchestrates the review session
   - Stores pending changes with positions
   - Tracks accept/reject state per change
   - Handles finalization and cleanup

2. **`ChangeDecorationPlugin`** (CodeMirror 6 ViewPlugin)
   - Renders colored backgrounds and strikethroughs
   - Updates decorations as changes are accepted/rejected
   - Uses `Decoration.mark()` for styling

3. **`ChangeHoverWidget`** (CodeMirror tooltip/widget)
   - Shows accept/reject buttons on hover
   - Positioned relative to change span

4. **`ReviewToolbar`**
   - Fixed-position floating DOM element
   - Communicates with InlineChangeManager
   - Shows change count and bulk action buttons

### State Flow

```
AI returns editFile tool call
        ↓
ToolExecutor extracts: { filePath, originalContent, proposedContent }
        ↓
InlineChangeManager.startReview(filePath, original, proposed)
        ↓
Compute diff → array of Change objects with positions
        ↓
ChangeDecorationPlugin renders decorations in editor
        ↓
User interacts (accept/reject individual or bulk)
        ↓
InlineChangeManager.finalize() → returns final content
        ↓
ToolExecutor writes file, sends result to AI
```

### Data Structures

```typescript
interface PendingChange {
  id: string;
  type: 'addition' | 'deletion' | 'replacement';
  from: number;        // CodeMirror position
  to: number;
  originalText: string;
  newText: string;
  status: 'pending' | 'accepted' | 'rejected';
}

interface ReviewSession {
  filePath: string;
  changes: PendingChange[];
  originalContent: string;
  isActive: boolean;
}
```

## Edge Cases

### Multiple File Edits

- Process files sequentially
- Show notification: "Reviewing file 1 of 3: `notes/meeting.md`"
- After finishing one, automatically open next
- "Skip" option treats file as reject-all

### Editing During Review

For v1: **Disable editing** while in review mode
- Note becomes read-only
- Visual indicator (subtle border/badge)
- Avoids complex position-remapping
- User can reject all and edit manually if needed

### Large Changes

When change spans many lines, collapse middle content:
```
░First deleted line...░
░[+12 more lines]░
░Last deleted line░
```
- Click to expand full change

### Navigation

- Toolbar includes "Jump to next change" (↓) button
- Scrolls to next pending change
- Helpful for long documents with scattered changes

### Cancel/Escape

- `Escape` key prompts: "Exit review? Pending changes will be rejected."
- Closing note tab triggers same prompt

## Out of Scope (v1)

- **Partial acceptance within a change** - Accept/reject whole changes only
- **Custom undo stack** - Use Obsidian's native undo after accepting
- **Concurrent reviews** - One file at a time
- **Editing while reviewing** - Read-only during review
- **Diff comments/annotations** - Use chat for discussion

## Migration

### Preserved from Current Implementation

- Diff computation logic (`diff-match-patch` library)
- Concept of "hunks" internally (renamed to "changes")
- Result structure (`DiffReviewResult`) - same interface, different UI

### Deprecated

- `DiffReviewModal` class - will be removed after new system is stable
- Modal-specific CSS classes (`hydrate-diff-modal`, `hydrate-diff-hunks-container`, etc.)

## Success Criteria

1. User can review changes without losing document context
2. Accept/reject individual changes with single click
3. Visual diff is immediately understandable (no mental parsing of +/-)
4. Works for small (1 line) to large (entire section) changes
5. Non-blocking - can scroll and read while reviewing

## Files to Create/Modify

### New Files
- `src/components/InlineChangeManager.ts`
- `src/components/ChangeDecorationPlugin.ts`
- `src/components/ChangeHoverWidget.ts`
- `src/components/ReviewToolbar.ts`

### Modified Files
- `src/components/HydrateView/ToolExecutor.ts` - Use new system instead of modal
- `src/hydrate-styles.css` - Add review mode styles

### Deprecated (remove after migration)
- `src/components/DiffReviewModal.ts`
