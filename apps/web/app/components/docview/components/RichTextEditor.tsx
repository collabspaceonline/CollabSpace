import React, { useEffect, useState, useRef, useImperativeHandle } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { Extension } from '@tiptap/core';
import { yCursorPlugin } from '@tiptap/y-tiptap';
import Collaboration from '@tiptap/extension-collaboration';

const CustomCollaborationCursor = Extension.create({
  name: 'collaborationCursor',
  addOptions() {
    return {
      provider: null,
      user: { name: 'User', color: '#f56565' },
    };
  },
  addProseMirrorPlugins() {
    return [
      yCursorPlugin(
        (() => {
          this.options.provider.awareness.setLocalStateField('user', this.options.user);
          return this.options.provider.awareness;
        })(),
        {
          cursorBuilder: (user: any) => {
            const cursor = document.createElement('span');
            cursor.classList.add('collaboration-cursor__caret');
            cursor.setAttribute('style', `border-color: ${user.color}`);
            const label = document.createElement('div');
            label.classList.add('collaboration-cursor__label');
            label.setAttribute('style', `background-color: ${user.color}`);
            label.insertBefore(document.createTextNode(user.name), null);
            cursor.insertBefore(label, null);
            return cursor;
          },
        }
      ),
    ];
  },
});
import { TextAlign } from '@tiptap/extension-text-align';
import { Underline } from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { Socket } from 'socket.io-client';

interface RichTextEditorProps {
  content: string;
  onChange: (newContent: string) => void;
  theme?: 'light' | 'dark';
  zoom?: number;
  socket?: Socket | null;
  documentId?: string;
}

const TiptapInner = React.forwardRef<any, { provider: WebsocketProvider, ydoc: Y.Doc, initialContent: string, onChange: (c: string) => void, theme: string, zoom: number }>(({ provider, ydoc, initialContent, onChange, theme, zoom }, ref) => {
  const isLoaded = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
      Collaboration.configure({
        document: ydoc,
      }),
      CustomCollaborationCursor.configure({
        provider: provider,
        user: {
          name: 'User ' + Math.floor(Math.random() * 100),
          color: ['#f56565', '#ed8936', '#ecc94b', '#48bb78', '#38b2ac', '#4299e1'][Math.floor(Math.random() * 6)],
        },
      }),
    ],
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: 'outline-none min-h-[750px] leading-relaxed prose prose-slate dark:prose-invert max-w-none text-base focus:ring-0',
      },
    },
  });

  useEffect(() => {
    if (!editor || !provider) return;

    const handleSync = (isSynced: boolean) => {
      if (isSynced && !isLoaded.current) {
        isLoaded.current = true;
        if (editor.isEmpty && initialContent) {
          editor.commands.setContent(initialContent);
        }
      }
    };
    provider.on('sync', handleSync);
    
    // Fallback if already synced
    if (provider.synced) {
      handleSync(true);
    }
    
    return () => {
      provider.off('sync', handleSync);
    };
  }, [editor, provider, initialContent]);

  useImperativeHandle(ref, () => ({
    format: (command: string, value?: string) => {
      if (!editor) return;
      
      editor.chain().focus();
      
      switch (command) {
        case 'bold': editor.chain().focus().toggleBold().run(); break;
        case 'italic': editor.chain().focus().toggleItalic().run(); break;
        case 'underline': editor.chain().focus().toggleUnderline().run(); break;
        case 'strikeThrough': editor.chain().focus().toggleStrike().run(); break;
        case 'justifyLeft': editor.chain().focus().setTextAlign('left').run(); break;
        case 'justifyCenter': editor.chain().focus().setTextAlign('center').run(); break;
        case 'justifyRight': editor.chain().focus().setTextAlign('right').run(); break;
        case 'justifyFull': editor.chain().focus().setTextAlign('justify').run(); break;
        case 'formatBlock':
          if (value === 'H1') editor.chain().focus().toggleHeading({ level: 1 }).run();
          if (value === 'H2') editor.chain().focus().toggleHeading({ level: 2 }).run();
          if (value === 'H3') editor.chain().focus().toggleHeading({ level: 3 }).run();
          if (value === 'P') editor.chain().focus().setParagraph().run();
          break;
        case 'insertOrderedList': editor.chain().focus().toggleOrderedList().run(); break;
        case 'insertUnorderedList': editor.chain().focus().toggleBulletList().run(); break;
        case 'foreColor': if (value) editor.chain().focus().setColor(value).run(); break;
      }
    },
  }));

  if (!editor) {
    return <div className="p-8 text-center">Loading Collaborative Editor...</div>;
  }

  return (
    <div
      className="w-full max-w-3xl min-h-[850px] p-8 md:p-12 rounded-xl shadow-2xl transition-transform origin-top tiptap-container"
      style={{
        transform: `scale(${zoom / 100})`,
        backgroundColor: theme === 'dark' ? '#181b2a' : '#ffffff',
        color: theme === 'dark' ? '#e2e8f0' : '#1e293b',
        border: theme === 'dark' ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid #e2e8f0',
        boxShadow: '0 20px 50px rgba(0,0,0,0.35)',
      }}
    >
      <EditorContent editor={editor} />
    </div>
  );
});

export const RichTextEditor = React.forwardRef<{ format: (command: string, value?: string) => void }, RichTextEditorProps>(
  ({ content, onChange, theme = 'dark', zoom = 100, socket, documentId }, ref) => {
    const [provider, setProvider] = useState<WebsocketProvider | null>(null);
    const ydocRef = useRef<Y.Doc | null>(null);

    useEffect(() => {
      const ydoc = new Y.Doc();
      ydocRef.current = ydoc;

      let wsUrl = 'ws://localhost:3001/yjs';
      
      if (socket && socket.io && (socket.io as any).uri) {
        const httpUrl = new URL((socket.io as any).uri);
        httpUrl.protocol = httpUrl.protocol === 'https:' ? 'wss:' : 'ws:';
        httpUrl.pathname = '/yjs';
        wsUrl = httpUrl.toString();
      } else if (process.env.NEXT_PUBLIC_SFU_SERVER_URL) {
        const httpUrl = new URL(process.env.NEXT_PUBLIC_SFU_SERVER_URL as string);
        httpUrl.protocol = httpUrl.protocol === 'https:' ? 'wss:' : 'ws:';
        httpUrl.pathname = '/yjs';
        wsUrl = httpUrl.toString();
      }

      const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
      const roomMatch = pathname.match(/\/room\/([^/]+)/);
      let roomId = (roomMatch && roomMatch[1]) ? roomMatch[1] : 'global-room';
      
      if (documentId) {
        roomId = `${roomId}-${documentId}`;
      }

      const wsProvider = new WebsocketProvider(
        wsUrl,
        roomId,
        ydoc
      );

      setProvider(wsProvider);

      return () => {
        wsProvider.destroy();
        ydoc.destroy();
      };
    }, [socket]);

    return (
      <div className="flex-1 flex flex-col items-center overflow-y-auto p-4 md:p-8 relative">
        {provider && ydocRef.current ? (
          <TiptapInner 
            ref={ref}
            provider={provider} 
            ydoc={ydocRef.current} 
            initialContent={content} 
            onChange={onChange} 
            theme={theme}
            zoom={zoom}
          />
        ) : (
          <div className="p-8 text-center text-white/50">Connecting to collaboration server...</div>
        )}
      </div>
    );
  }
);

RichTextEditor.displayName = 'RichTextEditor';
