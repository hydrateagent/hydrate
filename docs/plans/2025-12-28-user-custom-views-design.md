# User Custom Views - Design Document

> Created: 2025-12-28
> Status: Draft

## Overview

Allow Hydrate users to create custom views for their markdown files by describing what they want in natural language. The LLM generates React components that render the user's structured markdown as interactive UI (cards, tables, timelines, etc.). Users iterate on the design through conversation until satisfied.

This extends Hydrate's existing `ReactViewHost` architecture, which already powers the built-in issue board view.

## User Experience

### Creating a Custom View

1. **User creates a sample markdown file** with their desired data structure:

```markdown
---
hydrate-plugin: recipe-cards
---

## Grandma's Apple Pie
- prep-time: 30 min
- cook-time: 45 min
- cuisine: American
- image: pie.jpg

### Ingredients
- 6 apples
- 1 cup sugar
...

## Thai Green Curry
- prep-time: 20 min
- cook-time: 25 min
- cuisine: Thai
...
```

2. **User opens the file and prompts Hydrate:**

```
/create-view card layout with large images, title, cooking time badge,
and cuisine tag. Group by cuisine type.
```

3. **LLM generates the view:**
   - Reads the markdown structure to understand available fields
   - Reads frontmatter to get view name (`recipe-cards`)
   - Reads user's description to understand the vision
   - Generates `.obsidian/plugins/hydrate/views/recipe-cards.jsx`
   - View hot-reloads immediately

4. **User sees their recipes rendered as cards** and iterates:

```
User: "make the images bigger"
User: "add a heart icon for favorites"
User: "the cuisine tags should be colored by region"
```

Each prompt updates the code, view refreshes automatically.

5. **Done.** Any file with `hydrate-plugin: recipe-cards` in frontmatter now uses this view.

### Editing Existing Views

- User opens a file using a custom view
- Types feedback in Hydrate chat: "add filtering by prep time"
- LLM updates the existing `.jsx` file
- View refreshes

### Deleting Views

- User deletes the `.jsx` file from `.obsidian/plugins/hydrate/views/`
- Or via settings UI (future enhancement)

## Technical Architecture

### File Structure

```
.obsidian/plugins/hydrate/
├── views/                    # User-created views
│   ├── recipe-cards.jsx
│   ├── project-timeline.jsx
│   └── book-shelf.jsx
├── src/
│   ├── ReactViewHost.ts      # Existing - hosts React components
│   ├── ViewLoader.ts         # NEW - dynamic loading of user views
│   └── ...
```

### View Loading

The plugin loads user views at startup and when files change:

```typescript
// ViewLoader.ts (conceptual)
class ViewLoader {
  private views: Map<string, React.ComponentType<ReactViewProps>> = new Map();

  async loadAllViews(): Promise<void> {
    const viewsDir = '.obsidian/plugins/hydrate/views';
    const files = await this.app.vault.adapter.list(viewsDir);

    for (const file of files.filter(f => f.endsWith('.jsx'))) {
      await this.loadView(file);
    }
  }

  async loadView(path: string): Promise<void> {
    const code = await this.app.vault.adapter.read(path);
    const component = await this.compileAndEvaluate(code);
    const name = path.split('/').pop().replace('.jsx', '');
    this.views.set(name, component);
  }
}
```

### Code Generation

When user runs `/create-view`, the LLM receives:

1. **System context:** ReactViewProps interface, example components, available utilities
2. **File content:** The markdown structure to understand available data
3. **Frontmatter:** View name from `hydrate-plugin: xxx`
4. **User prompt:** Description of desired view

The LLM generates a complete React component following the established pattern:

```jsx
// .obsidian/plugins/hydrate/views/recipe-cards.jsx
import React from 'react';

export default function RecipeCards({ markdownContent, updateMarkdownContent }) {
  const recipes = parseRecipes(markdownContent);

  return (
    <div className="recipe-grid">
      {recipes.map(recipe => (
        <div key={recipe.id} className="recipe-card">
          <img src={recipe.image} alt={recipe.title} />
          <h3>{recipe.title}</h3>
          <span className="cook-time">{recipe.cookTime}</span>
          <span className="cuisine-tag">{recipe.cuisine}</span>
        </div>
      ))}
    </div>
  );
}

function parseRecipes(markdown) {
  // Parse markdown into recipe objects
  // ...
}
```

### Hot Reloading

When a `.jsx` file in the views directory changes:

1. Plugin detects file modification via vault events
2. Recompiles the changed component
3. Updates the component registry
4. Any open ReactViewHost using that view re-renders

### Security Considerations

User-generated code runs in the Obsidian context. Mitigations:

- **Code review prompt:** LLM is instructed to generate only UI code, no file system access beyond the provided APIs
- **Sandboxed evaluation:** Consider using a sandboxed evaluation context
- **User trust model:** User is generating their own code for their own use
- **Visible code:** Files are in the vault, user can inspect/version control

For v1, we accept that users generating code for themselves is a reasonable trust model (similar to Obsidian's existing plugin system).

## Component Interface

All user views receive the same props as built-in views:

```typescript
interface ReactViewProps {
  app: App;                    // Obsidian app instance
  plugin: HydratePlugin;       // Plugin instance
  filePath: string;            // Path to the markdown file
  markdownContent: string;     // Current file content
  updateMarkdownContent: (content: string) => Promise<boolean>;  // Save changes
  switchToMarkdownView: () => Promise<void>;  // Switch to editor
}
```

## LLM Context for Code Generation

When generating views, the LLM needs:

```markdown
## Context for /create-view

You are generating a React component for Hydrate, an Obsidian plugin.

### Component Interface
Your component receives these props:
- `markdownContent`: string - the raw markdown to parse and display
- `updateMarkdownContent`: (newContent: string) => Promise<boolean> - call to save changes
- `switchToMarkdownView`: () => void - switch back to markdown editor

### Requirements
- Export a default React functional component
- Parse the markdown to extract structured data
- Render interactive UI based on user's description
- Call updateMarkdownContent() when user makes changes
- Use Tailwind classes for styling (available in Hydrate)

### Current File Structure
[insert parsed markdown structure here]

### User's Vision
[insert user's /create-view prompt here]
```

## Edge Cases

### View doesn't exist yet
- File has `hydrate-plugin: my-view` but no `.jsx` file exists
- Show placeholder: "View 'my-view' not found. Use /create-view to create it."

### Code has errors
- Compilation fails or runtime error
- Show error message with option to switch to markdown view
- User can fix via chat: "there's an error, the recipes aren't showing"

### Multiple files, same view
- All files with `hydrate-plugin: recipe-cards` share the same view component
- Changes to the view affect all files using it

### View name conflicts with built-in
- User tries `hydrate-plugin: issue-board`
- Built-in views take precedence, or we namespace: `custom:issue-board`

## Feature Gating (Max)

Custom views is a Max-tier feature. Gating considerations:

### Gate Points

1. **`/create-view` command** - Check subscription before generating code
2. **View loading** - Should existing views still render for downgraded users?
3. **View editing** - Iterating on views via chat

### Scenarios

| User State | Create View | Load Existing View | Edit View |
|------------|-------------|-------------------|-----------|
| Max | Yes | Yes | Yes |
| Pro / Free | No - prompt to upgrade | N/A | N/A |
| Downgraded from Max | No | Yes (read-only) | No |

### Downgrade Behavior

If a Max user creates views and later downgrades:
- **Option A: Views still work (read-only)** - Views render, but user can't edit or create new ones. Gentle lock-in, good UX.
- **Option B: Views stop working** - Show "upgrade to Max" message. Harder sell, frustrating UX.

**Recommendation: Option A** - Let existing views keep working. User's data isn't held hostage, but they can't create/modify. This is fair and encourages re-subscription without resentment.

### Implementation

```typescript
// In /create-view handler
async function handleCreateView(description: string) {
  const subscription = await this.plugin.getSubscriptionStatus();

  if (!subscription.isMax) {
    addMessageToChat(this, "agent",
      "Custom views is a Max feature. Upgrade to create your own views.");
    return;
  }

  // Proceed with view generation...
}

// In view iteration handler
async function handleViewEdit(feedback: string) {
  const subscription = await this.plugin.getSubscriptionStatus();

  if (!subscription.isMax) {
    addMessageToChat(this, "agent",
      "Editing custom views requires Max. Your existing views will continue to work.");
    return;
  }

  // Proceed with edit...
}
```

### Edge Cases

- **Shared vaults:** User A (Max) creates view, User B (Pro/Free) opens file
  - View renders for User B (it's just a .jsx file)
  - User B can't edit the view via chat

- **Git-synced views:** User pulls views from repo but isn't Max
  - Views render (read-only)
  - Can't create/modify

- **Built-in views:** `issue-board` remains free for all users

## Future Enhancements

- **View library:** Share views with community
- **Visual debugging:** Click element to reference in chat
- **View settings:** Per-file configuration in frontmatter
- **TypeScript support:** `.tsx` files with type checking
- **Component library:** Pre-built components users can compose

## Implementation Plan

### Phase 1: Dynamic View Loading
- [ ] Create ViewLoader service
- [ ] Load `.jsx` files from views directory
- [ ] Integrate with existing ReactViewHost
- [ ] Hot reload on file changes

### Phase 2: Code Generation
- [ ] Create `/create-view` command handler
- [ ] Build LLM context with file structure + props interface
- [ ] Generate and save component code
- [ ] Error handling and user feedback

### Phase 3: Iteration Flow
- [ ] Detect when user is chatting about current view
- [ ] Update existing view code vs creating new
- [ ] Improve hot reload performance

### Phase 4: Polish
- [ ] Settings UI for managing views
- [ ] Better error messages
- [ ] View templates/examples
