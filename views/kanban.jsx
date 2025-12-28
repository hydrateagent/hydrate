import React, { useState, useEffect, useRef } from 'react';

export default function KanbanView({ markdownContent, updateMarkdownContent, switchToMarkdownView }) {
  const [columns, setColumns] = useState([]);
  const [isParsing, setIsParsing] = useState(true);

  // --- Parsing & Serialization ---

  useEffect(() => {
    parseMarkdown(markdownContent);
  }, [markdownContent]);

  const parseMarkdown = (content) => {
    try {
      const lines = content.split('\n');
      const parsedColumns = [];
      let currentColumn = null;
      let currentCard = null;
      let insideFrontmatter = false;
      let frontmatterCount = 0;

      lines.forEach((line, index) => {
        const trimmedLine = line.trim();

        // Handle Frontmatter skipping
        if (trimmedLine === '---') {
          frontmatterCount++;
          if (frontmatterCount <= 2) return;
        }
        if (frontmatterCount < 2) return;

        // Column Header (# Title)
        if (line.startsWith('# ')) {
          currentColumn = {
            id: `col-${Date.now()}-${Math.random()}`,
            title: line.substring(2).trim(),
            cards: []
          };
          parsedColumns.push(currentColumn);
          currentCard = null;
        } 
        // Card Header (## Title)
        else if (line.startsWith('## ') && currentColumn) {
          currentCard = {
            id: `card-${Date.now()}-${Math.random()}`,
            title: line.substring(3).trim(),
            description: ''
          };
          currentColumn.cards.push(currentCard);
        }
        // Description / Content
        else if (currentCard && trimmedLine.length > 0) {
          // Append text, handling newlines
          currentCard.description = currentCard.description 
            ? `${currentCard.description}\n${line}` 
            : line;
        }
      });

      // If empty or no columns found, initialize with defaults to prevent UI lockup
      if (parsedColumns.length === 0 && !content.includes('# ')) {
        setColumns([
          { id: 'c1', title: 'To Do', cards: [] },
          { id: 'c2', title: 'Done', cards: [] }
        ]);
      } else {
        setColumns(parsedColumns);
      }
    } catch (e) {
      console.error("Failed to parse Kanban markdown", e);
    } finally {
      setIsParsing(false);
    }
  };

  const serializeAndSave = async (newColumns) => {
    let md = `---
hydrate-plugin: kanban
---

`;
    
    newColumns.forEach(col => {
      md += `# ${col.title}\n\n`;
      col.cards.forEach(card => {
        md += `## ${card.title}\n\n`;
        if (card.description && card.description.trim()) {
          md += `${card.description.trim()}\n\n`;
        }
      });
    });

    await updateMarkdownContent(md);
  };

  // --- Actions ---

  const handleUpdate = (newColumns) => {
    setColumns(newColumns);
    serializeAndSave(newColumns);
  };

  const addColumn = () => {
    const newCol = {
      id: `col-${Date.now()}`,
      title: 'New List',
      cards: []
    };
    handleUpdate([...columns, newCol]);
  };

  const addCard = (colIndex) => {
    const newColumns = [...columns];
    newColumns[colIndex].cards.push({
      id: `card-${Date.now()}`,
      title: 'New Task',
      description: ''
    });
    handleUpdate(newColumns);
  };

  const updateCardTitle = (colIndex, cardIndex, newTitle) => {
    const newColumns = [...columns];
    newColumns[colIndex].cards[cardIndex].title = newTitle;
    handleUpdate(newColumns);
  };

  const updateCardDesc = (colIndex, cardIndex, newDesc) => {
    const newColumns = [...columns];
    newColumns[colIndex].cards[cardIndex].description = newDesc;
    handleUpdate(newColumns);
  };

  const updateColumnTitle = (colIndex, newTitle) => {
    const newColumns = [...columns];
    newColumns[colIndex].title = newTitle;
    handleUpdate(newColumns);
  };

  const moveCard = (sourceColIndex, cardIndex, direction) => {
    const targetColIndex = sourceColIndex + direction;
    if (targetColIndex < 0 || targetColIndex >= columns.length) return;

    const newColumns = [...columns];
    const [card] = newColumns[sourceColIndex].cards.splice(cardIndex, 1);
    newColumns[targetColIndex].cards.push(card);
    handleUpdate(newColumns);
  };

  const deleteCard = (colIndex, cardIndex) => {
    const newColumns = [...columns];
    newColumns[colIndex].cards.splice(cardIndex, 1);
    handleUpdate(newColumns);
  };
  
  const deleteColumn = (colIndex) => {
    if(!window.confirm("Delete this column and all its tasks?")) return;
    const newColumns = [...columns];
    newColumns.splice(colIndex, 1);
    handleUpdate(newColumns);
  };

  if (isParsing) return <div style={{ padding: 20, color: 'var(--text-muted)' }}>Loading Kanban...</div>;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      backgroundColor: 'var(--background-primary)',
      color: 'var(--text-normal)',
      fontFamily: 'var(--font-interface)'
    }}>
      {/* Toolbar */}
      <div style={{
        padding: '12px 20px',
        borderBottom: '1px solid var(--background-modifier-border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div style={{ fontWeight: 'bold', fontSize: '1.1em' }}>Kanban Board</div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button 
            onClick={addColumn}
            style={{
              backgroundColor: 'var(--interactive-accent)',
              color: 'var(--text-on-accent)',
              border: 'none',
              borderRadius: '4px',
              padding: '6px 12px',
              cursor: 'pointer',
              fontWeight: 500
            }}
          >
            + Add Column
          </button>
          <button 
            onClick={switchToMarkdownView}
            style={{
              backgroundColor: 'transparent',
              color: 'var(--text-muted)',
              border: '1px solid var(--background-modifier-border)',
              borderRadius: '4px',
              padding: '6px 12px',
              cursor: 'pointer'
            }}
          >
            Source
          </button>
        </div>
      </div>

      {/* Board Area */}
      <div style={{
        flex: 1,
        overflowX: 'auto',
        overflowY: 'hidden',
        padding: '20px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '16px'
      }}>
        {columns.map((col, colIndex) => (
          <div key={col.id} style={{
            minWidth: '300px',
            width: '300px',
            backgroundColor: 'var(--background-secondary)',
            borderRadius: '8px',
            border: '1px solid var(--background-modifier-border)',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: '100%'
          }}>
            {/* Column Header */}
            <div style={{
              padding: '12px',
              borderBottom: '1px solid var(--background-modifier-border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '8px'
            }}>
              <input 
                value={col.title}
                onChange={(e) => updateColumnTitle(colIndex, e.target.value)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontWeight: '600',
                  fontSize: '1em',
                  color: 'var(--text-normal)',
                  width: '100%',
                  outline: 'none'
                }}
              />
              <button 
                onClick={() => deleteColumn(colIndex)}
                title="Delete Column"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: '16px',
                  padding: '4px'
                }}
              >
                ×
              </button>
            </div>

            {/* Cards Container */}
            <div style={{
              padding: '12px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              minHeight: '50px'
            }}>
              {col.cards.map((card, cardIndex) => (
                <div key={card.id} style={{
                  backgroundColor: 'var(--background-primary)',
                  border: '1px solid var(--background-modifier-border)',
                  borderRadius: '6px',
                  padding: '10px',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                  transition: 'box-shadow 0.2s'
                }}>
                  {/* Card Title */}
                  <div style={{ marginBottom: '8px' }}>
                    <input
                      value={card.title}
                      onChange={(e) => updateCardTitle(colIndex, cardIndex, e.target.value)}
                      placeholder="Task Title"
                      style={{
                        width: '100%',
                        background: 'transparent',
                        border: 'none',
                        borderBottom: '1px dashed var(--background-modifier-border)',
                        color: 'var(--text-normal)',
                        fontWeight: '500',
                        paddingBottom: '4px',
                        outline: 'none'
                      }}
                    />
                  </div>
                  
                  {/* Card Description */}
                  <textarea
                    value={card.description}
                    onChange={(e) => updateCardDesc(colIndex, cardIndex, e.target.value)}
                    placeholder="Add description..."
                    rows={2}
                    style={{
                      width: '100%',
                      background: 'var(--background-primary)',
                      border: 'none',
                      color: 'var(--text-muted)',
                      fontSize: '0.9em',
                      resize: 'vertical',
                      fontFamily: 'inherit',
                      outline: 'none'
                    }}
                  />

                  {/* Card Actions */}
                  <div style={{
                    marginTop: '8px',
                    paddingTop: '8px',
                    borderTop: '1px solid var(--background-modifier-border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button
                        disabled={colIndex === 0}
                        onClick={() => moveCard(colIndex, cardIndex, -1)}
                        title="Move Left"
                        style={{
                          background: 'var(--background-modifier-hover)',
                          border: 'none',
                          borderRadius: '4px',
                          color: 'var(--text-muted)',
                          cursor: colIndex === 0 ? 'default' : 'pointer',
                          opacity: colIndex === 0 ? 0.3 : 1,
                          padding: '2px 6px',
                          fontSize: '12px'
                        }}
                      >
                        ←
                      </button>
                      <button
                        disabled={colIndex === columns.length - 1}
                        onClick={() => moveCard(colIndex, cardIndex, 1)}
                        title="Move Right"
                        style={{
                          background: 'var(--background-modifier-hover)',
                          border: 'none',
                          borderRadius: '4px',
                          color: 'var(--text-muted)',
                          cursor: colIndex === columns.length - 1 ? 'default' : 'pointer',
                          opacity: colIndex === columns.length - 1 ? 0.3 : 1,
                          padding: '2px 6px',
                          fontSize: '12px'
                        }}
                      >
                        →
                      </button>
                    </div>
                    <button
                      onClick={() => deleteCard(colIndex, cardIndex)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-error)', // Using error color specifically for delete
                        cursor: 'pointer',
                        fontSize: '12px',
                        padding: '2px 6px'
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Footer / Add Card */}
            <div style={{
              padding: '12px',
              borderTop: '1px solid var(--background-modifier-border)'
            }}>
              <button
                onClick={() => addCard(colIndex)}
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: '1px dashed var(--background-modifier-border)',
                  borderRadius: '4px',
                  color: 'var(--text-muted)',
                  padding: '8px',
                  cursor: 'pointer',
                  fontSize: '0.9em',
                  transition: 'background 0.2s'
                }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--background-modifier-hover)'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                + Add Task
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}