import React, { useEffect, useRef, useState } from 'react';

interface RichTextEditorProps {
  content: string;
  onChange: (newContent: string) => void;
  theme?: 'light' | 'dark';
  zoom?: number;
}

export const RichTextEditor = React.forwardRef<{ format: (command: string, value?: string) => void }, RichTextEditorProps>(
  ({ content, onChange, theme = 'dark', zoom = 100 }, ref) => {
    const editorRef = useRef<HTMLDivElement>(null);
    const isTypingRef = useRef(false);
    const [wordCount, setWordCount] = useState(0);
    const [charCount, setCharCount] = useState(0);

    // Initial content setup & external update sync (preventing overwrite while user is typing)
    useEffect(() => {
      if (editorRef.current && !isTypingRef.current) {
        if (editorRef.current.innerHTML !== content) {
          editorRef.current.innerHTML = content || '<p>Start typing or edit the uploaded document here...</p>';
          updateStats();
        }
      }
    }, [content]);

    const updateStats = () => {
      if (!editorRef.current) return;
      const text = editorRef.current.innerText || '';
      const words = text.trim().split(/\s+/).filter(Boolean).length;
      setWordCount(words);
      setCharCount(text.length);
    };

    const handleInput = () => {
      if (!editorRef.current) return;
      isTypingRef.current = true;
      const html = editorRef.current.innerHTML;
      onChange(html);
      updateStats();

      // Reset typing flag shortly after
      setTimeout(() => {
        isTypingRef.current = false;
      }, 300);
    };

    React.useImperativeHandle(ref, () => ({
      format: (command: string, value?: string) => {
        if (!editorRef.current) return;
        editorRef.current.focus();
        document.execCommand(command, false, value);
        handleInput();
      },
    }));

    return (
      <div className="flex-1 flex flex-col items-center overflow-y-auto p-4 md:p-8 relative">
        {/* Document Page container */}
        <div
          className="w-full max-w-3xl min-h-[850px] p-8 md:p-12 rounded-xl shadow-2xl transition-transform origin-top"
          style={{
            transform: `scale(${zoom / 100})`,
            backgroundColor: theme === 'dark' ? '#181b2a' : '#ffffff',
            color: theme === 'dark' ? '#e2e8f0' : '#1e293b',
            border: theme === 'dark' ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid #e2e8f0',
            boxShadow: '0 20px 50px rgba(0,0,0,0.35)',
          }}
        >
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onInput={handleInput}
            className="outline-none min-h-[750px] leading-relaxed prose prose-slate dark:prose-invert max-w-none text-base focus:ring-0"
            style={{
              fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
            }}
          />
        </div>

        {/* Floating footer stats */}
        <div
          className="sticky bottom-3 mt-4 px-3 py-1 rounded-full text-[11px] font-mono tracking-wider backdrop-blur-md border shadow-lg"
          style={{
            backgroundColor: theme === 'dark' ? 'rgba(15, 23, 42, 0.8)' : 'rgba(255, 255, 255, 0.8)',
            borderColor: theme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
            color: theme === 'dark' ? 'rgba(255, 255, 255, 0.6)' : 'rgba(0, 0, 0, 0.6)',
          }}
        >
          {wordCount} words • {charCount} chars
        </div>
      </div>
    );
  }
);

RichTextEditor.displayName = 'RichTextEditor';
