import React, { useState, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { AnnotationTool } from './types';
import { useDocSync } from './hooks/useDocSync';
import { DocToolbar } from './components/DocToolbar';
import { RichTextEditor } from './components/RichTextEditor';
import { PdfViewer } from './components/PdfViewer';
import { DocxViewer } from './components/DocxViewer';
import { PptxViewer } from './components/PptxViewer';
import { ACCEPTED_EXTENSIONS } from './constants';

interface DocViewerProps {
  socket: Socket | null;
  theme?: 'light' | 'dark';
}

export const DocViewer: React.FC<DocViewerProps> = ({ socket, theme = 'dark' }) => {
  const {
    docState,
    isUploading,
    uploadError,
    uploadDocument,
    updateContent,
    addAnnotation,
    deleteAnnotation,
    clearAnnotations,
    closeDocument,
  } = useDocSync(socket);

  const [activeTool, setActiveTool] = useState<AnnotationTool>('select');
  const [activeColor, setActiveColor] = useState<string>('#3b82f6');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<{ format: (command: string, value?: string) => void }>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      uploadDocument(file);
    }
  };

  const handleCreateBlankDoc = () => {
    if (!socket) return;
    const blankFile = new File(['<p><h1>Untitled Document</h1><p>Start collaborating and editing here...</p></p>'], 'Untitled Document.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    uploadDocument(blankFile);
  };

  const handleExport = () => {
    if (!docState.file) return;

    if (docState.file.type === 'pdf' && docState.pdfData) {
      const a = document.createElement('a');
      a.href = docState.pdfData;
      a.download = docState.file.name || 'document.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }

    if (docState.file.type === 'docx' && docState.docxData) {
      const a = document.createElement('a');
      a.href = docState.docxData;
      a.download = docState.file.name || 'document.docx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }

    if ((docState.file.type === 'pptx' || docState.file.type === 'ppt') && docState.pptxData) {
      const a = document.createElement('a');
      a.href = docState.pptxData;
      a.download = docState.file.name || 'document.pptx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }

    // Export HTML / DOC
    const blob = new Blob([docState.content], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (docState.file.name || 'document').replace(/\.[^/.]+$/, '') + '.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleFormatText = (command: string, value?: string) => {
    editorRef.current?.format(command, value);
  };

  return (
    <div
      className="w-full h-full flex flex-col overflow-hidden relative"
      style={{
        backgroundColor: 'var(--card-bg, #0f172a)',
        color: 'var(--text-primary, #f8fafc)',
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Hidden file input for drag & drop zone button */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS.join(',')}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) uploadDocument(file);
          e.target.value = '';
        }}
      />

      {/* Top Toolbar */}
      <DocToolbar
        file={docState.file}
        activeTool={activeTool}
        onSelectTool={setActiveTool}
        activeColor={activeColor}
        onSelectColor={setActiveColor}
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
        zoom={zoom}
        onZoomChange={setZoom}
        onUploadFile={uploadDocument}
        onExport={handleExport}
        onCloseDocument={closeDocument}
        onFormatText={handleFormatText}
        isUploading={isUploading}
      />

      {/* Upload Error Banner */}
      {uploadError && (
        <div className="bg-rose-500/20 text-rose-300 border-b border-rose-500/30 px-4 py-2 text-xs flex items-center justify-between">
          <span>{uploadError}</span>
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {isUploading ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-medium text-white/70">Processing and synchronizing document...</p>
          </div>
        ) : !docState.file ? (
          /* Empty / Upload state */
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div
              className={`max-w-md w-full p-8 rounded-2xl border-2 border-dashed transition-all flex flex-col items-center gap-4 ${
                isDragOver
                  ? 'border-blue-500 bg-blue-500/10 scale-102'
                  : 'border-white/15 bg-white/5 hover:border-white/25'
              }`}
            >
              <div className="w-14 h-14 rounded-2xl bg-blue-500/10 text-blue-400 flex items-center justify-center shadow-inner">
                <span className="material-symbols-rounded !text-[32px]">description</span>
              </div>

              <div>
                <h3 className="text-base font-semibold text-white">Upload a document</h3>
                <p className="text-xs text-white/60 mt-1">
                  Drag and drop your <strong>.docx</strong>, <strong>.pptx</strong>, or <strong>.pdf</strong> file to view and edit in real time with everyone.
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white shadow-md transition-all hover:opacity-90 active:scale-95"
                  style={{
                    background: 'linear-gradient(135deg, #1a73e8 0%, #4285f4 100%)',
                  }}
                >
                  Browse Files
                </button>

                <button
                  onClick={handleCreateBlankDoc}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-white/10 hover:bg-white/15 text-white/90 transition-all active:scale-95"
                >
                  Create Blank Doc
                </button>
              </div>

              <span className="text-[10px] text-white/40 tracking-wider font-mono uppercase">
                Supported: PDF, DOCX, DOC, TXT (Up to 25MB)
              </span>
            </div>
          </div>
        ) : docState.file.type === 'pdf' && docState.pdfData ? (
          /* PDF Viewer & Annotation */
          <PdfViewer
            pdfData={docState.pdfData}
            currentPage={currentPage}
            onTotalPagesChange={setTotalPages}
            onPageChange={setCurrentPage}
            annotations={docState.annotations}
            onAddAnnotation={addAnnotation}
            onDeleteAnnotation={deleteAnnotation}
            activeTool={activeTool}
            activeColor={activeColor}
            zoom={zoom}
            theme={theme}
          />
        ) : docState.file.type === 'docx' && docState.docxData ? (
          /* DOCX Viewer */
          <DocxViewer
            docxData={docState.docxData}
            theme={theme}
            zoom={zoom}
          />
        ) : (docState.file.type === 'pptx' || docState.file.type === 'ppt') && docState.pptxData ? (
          /* PPTX Viewer */
          <PptxViewer
            pptxData={docState.pptxData}
            theme={theme}
            zoom={zoom}
          />
        ) : (
          <RichTextEditor
            key={docState.file.name + docState.file.size}
            documentId={docState.file.name + '-' + docState.file.size}
            ref={editorRef}
            content={docState.content}
            onChange={updateContent}
            theme={theme}
            zoom={zoom}
            socket={socket}
          />
        )}
      </div>
    </div>
  );
};
