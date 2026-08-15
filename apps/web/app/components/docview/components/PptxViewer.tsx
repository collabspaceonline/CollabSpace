import React, { useEffect, useRef, useState } from 'react';

interface PptxViewerProps {
  pptxData: string;
  theme?: 'light' | 'dark';
  zoom?: number;
}

export const PptxViewer: React.FC<PptxViewerProps> = ({ pptxData, theme = 'dark', zoom = 100 }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const previewerRef = useRef<any>(null);

  useEffect(() => {
    let isCancelled = false;
    
    async function renderPptx() {
      if (!containerRef.current || !pptxData) return;
      
      try {
        // Convert data URL to ArrayBuffer
        const response = await fetch(pptxData);
        const arrayBuffer = await response.arrayBuffer();
        
        if (isCancelled) return;

        // Load the pptx-preview library dynamically
        const pptxPreview = await import('pptx-preview');
        
        if (isCancelled) return;

        // Clear container
        containerRef.current.innerHTML = '';
        
        // Initialize previewer
        // The library creates a wrapper inside the dom element
        previewerRef.current = pptxPreview.init(containerRef.current, {
           width: 960,
           height: 540,
        });

        await previewerRef.current.preview(arrayBuffer);
        
      } catch (err: any) {
        console.error('Failed to render PPTX:', err);
        if (!isCancelled) setError('Failed to render PowerPoint presentation. The file might be corrupted or unsupported.');
      }
    }

    renderPptx();

    return () => {
      isCancelled = true;
      if (previewerRef.current?.destroy) {
        try {
          previewerRef.current.destroy();
        } catch (e) {}
      }
    };
  }, [pptxData]);

  // Handle zoom logic (basic CSS transform for the container since pptx-preview might not support dynamic zoom easily)
  const scale = zoom / 100;

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-center text-red-400">
        <p className="bg-red-400/10 p-4 rounded-xl border border-red-400/20">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 w-full h-full overflow-auto bg-black/5 flex items-center justify-center p-4">
      <div 
        className="transition-transform duration-200"
        style={{ 
           transform: `scale(${scale})`, 
           transformOrigin: 'center center' 
        }}
      >
        <div 
          ref={containerRef}
          className="rounded-xl overflow-hidden shadow-2xl bg-white"
          style={{
            minWidth: 960,
            minHeight: 540
          }}
        />
      </div>
    </div>
  );
};
