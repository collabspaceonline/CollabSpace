import React, { useRef } from 'react';
import { DocFileInfo, AnnotationTool } from '../types';
import { ANNOTATION_COLORS, ACCEPTED_EXTENSIONS } from '../constants';

interface DocToolbarProps {
  file: DocFileInfo | null;
  activeTool?: AnnotationTool;
  onSelectTool?: (tool: AnnotationTool) => void;
  activeColor?: string;
  onSelectColor?: (color: string) => void;
  currentPage?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  onUploadFile: (file: File) => void;
  onExport: () => void;
  onCloseDocument: () => void;
  onFormatText?: (command: string, value?: string) => void;
  isUploading?: boolean;
}

export const DocToolbar: React.FC<DocToolbarProps> = ({
  file,
  activeTool = 'select',
  onSelectTool,
  activeColor = '#3b82f6',
  onSelectColor,
  currentPage = 1,
  totalPages = 1,
  onPageChange,
  zoom = 100,
  onZoomChange,
  onUploadFile,
  onExport,
  onCloseDocument,
  onFormatText,
  isUploading = false,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      onUploadFile(selected);
      // Reset input value so same file can be re-uploaded if needed
      e.target.value = '';
    }
  };

  const isPdf = file?.type === 'pdf';

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b backdrop-blur-md transition-colors"
      style={{
        background: 'var(--card-bg, rgba(20, 24, 39, 0.95))',
        borderColor: 'var(--border, rgba(255, 255, 255, 0.1))',
      }}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS.join(',')}
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Left side: Document Info & Upload */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white shadow-sm transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
          style={{
            background: 'linear-gradient(135deg, #1a73e8 0%, #4285f4 100%)',
          }}
          title="Upload .docx, .doc, or .pdf"
        >
          <span className="material-symbols-rounded !text-[16px]">upload_file</span>
          <span>{isUploading ? 'Uploading...' : 'Upload Doc'}</span>
        </button>

        {file && (
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="text-xs font-bold uppercase px-1.5 py-0.5 rounded tracking-wider text-blue-400 bg-blue-500/10 border border-blue-500/20"
            >
              {file.type}
            </span>
            <span
              className="text-xs font-medium truncate max-w-[150px] md:max-w-[220px]"
              style={{ color: 'var(--text-primary, #f1f5f9)' }}
              title={file.name}
            >
              {file.name}
            </span>
          </div>
        )}
      </div>

      {/* Center: Contextual Tools (Rich Text formatting or PDF tools) */}
      <div className="flex items-center gap-1 flex-wrap">
        {file && !isPdf && onFormatText && (
          <div className="flex items-center gap-0.5 bg-white/5 p-1 rounded-lg border border-white/10">
            <button
              onClick={() => onFormatText('bold')}
              className="p-1.5 rounded hover:bg-white/10 text-white/80 hover:text-white transition-colors"
              title="Bold (Ctrl+B)"
            >
              <span className="material-symbols-rounded !text-[16px]">format_bold</span>
            </button>
            <button
              onClick={() => onFormatText('italic')}
              className="p-1.5 rounded hover:bg-white/10 text-white/80 hover:text-white transition-colors"
              title="Italic (Ctrl+I)"
            >
              <span className="material-symbols-rounded !text-[16px]">format_italic</span>
            </button>
            <button
              onClick={() => onFormatText('underline')}
              className="p-1.5 rounded hover:bg-white/10 text-white/80 hover:text-white transition-colors"
              title="Underline (Ctrl+U)"
            >
              <span className="material-symbols-rounded !text-[16px]">format_underlined</span>
            </button>

            <div className="w-px h-4 bg-white/15 mx-1" />

            <button
              onClick={() => onFormatText('formatBlock', '<h1>')}
              className="p-1.5 rounded hover:bg-white/10 text-white/80 hover:text-white text-xs font-bold"
              title="Heading 1"
            >
              H1
            </button>
            <button
              onClick={() => onFormatText('formatBlock', '<h2>')}
              className="p-1.5 rounded hover:bg-white/10 text-white/80 hover:text-white text-xs font-bold"
              title="Heading 2"
            >
              H2
            </button>
            <button
              onClick={() => onFormatText('formatBlock', '<p>')}
              className="p-1.5 rounded hover:bg-white/10 text-white/80 hover:text-white text-xs font-medium"
              title="Normal Text"
            >
              P
            </button>

            <div className="w-px h-4 bg-white/15 mx-1" />

            <button
              onClick={() => onFormatText('insertUnorderedList')}
              className="p-1.5 rounded hover:bg-white/10 text-white/80 hover:text-white transition-colors"
              title="Bullet List"
            >
              <span className="material-symbols-rounded !text-[16px]">format_list_bulleted</span>
            </button>
            <button
              onClick={() => onFormatText('insertOrderedList')}
              className="p-1.5 rounded hover:bg-white/10 text-white/80 hover:text-white transition-colors"
              title="Numbered List"
            >
              <span className="material-symbols-rounded !text-[16px]">format_list_numbered</span>
            </button>
          </div>
        )}

        {file && isPdf && (
          <div className="flex items-center gap-1.5 bg-white/5 p-1 rounded-lg border border-white/10">
            {/* Annotation tools */}
            <button
              onClick={() => onSelectTool?.('select')}
              className={`p-1.5 rounded transition-colors ${
                activeTool === 'select'
                  ? 'bg-blue-600 text-white'
                  : 'text-white/70 hover:text-white hover:bg-white/10'
              }`}
              title="Select / Pan"
            >
              <span className="material-symbols-rounded !text-[16px]">pan_tool</span>
            </button>
            <button
              onClick={() => onSelectTool?.('pen')}
              className={`p-1.5 rounded transition-colors ${
                activeTool === 'pen'
                  ? 'bg-blue-600 text-white'
                  : 'text-white/70 hover:text-white hover:bg-white/10'
              }`}
              title="Draw / Pen"
            >
              <span className="material-symbols-rounded !text-[16px]">edit</span>
            </button>
            <button
              onClick={() => onSelectTool?.('highlighter')}
              className={`p-1.5 rounded transition-colors ${
                activeTool === 'highlighter'
                  ? 'bg-blue-600 text-white'
                  : 'text-white/70 hover:text-white hover:bg-white/10'
              }`}
              title="Highlight"
            >
              <span className="material-symbols-rounded !text-[16px]">ink_highlighter</span>
            </button>
            <button
              onClick={() => onSelectTool?.('eraser')}
              className={`p-1.5 rounded transition-colors ${
                activeTool === 'eraser'
                  ? 'bg-blue-600 text-white'
                  : 'text-white/70 hover:text-white hover:bg-white/10'
              }`}
              title="Eraser"
            >
              <span className="material-symbols-rounded !text-[16px]">ink_eraser</span>
            </button>

            {/* Colors */}
            <div className="flex items-center gap-1 ml-1 px-1 border-l border-white/15">
              {ANNOTATION_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => onSelectColor?.(c)}
                  className={`w-4 h-4 rounded-full transition-transform ${
                    activeColor === c ? 'scale-125 ring-2 ring-white' : 'opacity-70 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>

            {/* Page navigation */}
            {totalPages > 1 && onPageChange && (
              <div className="flex items-center gap-1 ml-2 pl-2 border-l border-white/15">
                <button
                  onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                  disabled={currentPage <= 1}
                  className="p-1 rounded text-white/70 hover:text-white disabled:opacity-30"
                  title="Previous Page"
                >
                  <span className="material-symbols-rounded !text-[14px]">chevron_left</span>
                </button>
                <span className="text-xs font-mono text-white/80">
                  {currentPage} / {totalPages}
                </span>
                <button
                  onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage >= totalPages}
                  className="p-1 rounded text-white/70 hover:text-white disabled:opacity-30"
                  title="Next Page"
                >
                  <span className="material-symbols-rounded !text-[14px]">chevron_right</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right side: Zoom, Export, Close */}
      <div className="flex items-center gap-2">
        {file && onZoomChange && (
          <div className="flex items-center gap-1 bg-white/5 px-2 py-1 rounded-lg border border-white/10">
            <button
              onClick={() => onZoomChange(Math.max(50, zoom - 15))}
              className="text-white/70 hover:text-white"
              title="Zoom out"
            >
              <span className="material-symbols-rounded !text-[14px]">remove</span>
            </button>
            <span className="text-[11px] font-mono text-white/80 w-10 text-center">
              {zoom}%
            </span>
            <button
              onClick={() => onZoomChange(Math.min(200, zoom + 15))}
              className="text-white/70 hover:text-white"
              title="Zoom in"
            >
              <span className="material-symbols-rounded !text-[14px]">add</span>
            </button>
          </div>
        )}

        {file && (
          <>
            <button
              onClick={onExport}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/15 text-white/90 transition-colors"
              title="Export / Download"
            >
              <span className="material-symbols-rounded !text-[15px]">download</span>
              <span className="hidden sm:inline">Export</span>
            </button>

            <button
              onClick={onCloseDocument}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-rose-400 hover:bg-rose-500/10 transition-colors"
              title="Close Document"
            >
              <span className="material-symbols-rounded !text-[15px]">close</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
};
