import React, { useEffect, useRef, useState } from 'react';
import * as docx from 'docx-preview';

interface DocxViewerProps {
  docxData: string;
  theme?: 'light' | 'dark';
  zoom?: number;
}

export const DocxViewer: React.FC<DocxViewerProps> = ({ docxData, theme = 'dark', zoom = 100 }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || !docxData) return;

    let isMounted = true;

    const renderDocx = async () => {
      try {
        const response = await fetch(docxData);
        const blob = await response.blob();
        
        if (!isMounted) return;
        
        // Render document
        if (containerRef.current) {
          // Clear previous
          containerRef.current.innerHTML = '';
          await docx.renderAsync(blob, containerRef.current, undefined, {
            className: 'docx-viewer-content',
            inWrapper: true,
            ignoreWidth: false,
            ignoreHeight: false,
            ignoreFonts: false,
            breakPages: true,
            useBase64URL: true,
          });
        }
      } catch (err) {
        console.error('Failed to render DOCX:', err);
        if (isMounted) {
          setError('Failed to render Word document.');
        }
      }
    };

    renderDocx();

    return () => {
      isMounted = false;
    };
  }, [docxData]);

  return (
    <div className="flex-1 flex flex-col items-center overflow-y-auto p-4 md:p-8 relative">
      <div
        className="w-full max-w-5xl transition-transform origin-top"
        style={{
          transform: `scale(${zoom / 100})`,
        }}
      >
        {error ? (
          <div className="p-8 text-center text-rose-500">{error}</div>
        ) : (
          <div 
            ref={containerRef} 
            className={`docx-container ${theme === 'dark' ? 'docx-dark-theme' : ''}`}
            style={{
              // Some basic styling to make it look like a document viewer
              backgroundColor: theme === 'dark' ? '#181b2a' : '#ffffff',
              padding: '20px',
              borderRadius: '8px',
              boxShadow: '0 20px 50px rgba(0,0,0,0.35)',
            }}
          />
        )}
      </div>
    </div>
  );
};
