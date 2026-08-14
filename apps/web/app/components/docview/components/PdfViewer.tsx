import React, { useEffect, useRef, useState, useCallback } from 'react';
import { DocAnnotation, AnnotationTool } from '../types';

interface PdfViewerProps {
  pdfData: string;
  currentPage: number;
  onTotalPagesChange: (total: number) => void;
  annotations: DocAnnotation[];
  onAddAnnotation: (annotation: DocAnnotation) => void;
  onDeleteAnnotation: (id: string) => void;
  activeTool: AnnotationTool;
  activeColor: string;
  zoom?: number;
  theme?: 'light' | 'dark';
}

export const PdfViewer: React.FC<PdfViewerProps> = ({
  pdfData,
  currentPage,
  onTotalPagesChange,
  annotations,
  onAddAnnotation,
  onDeleteAnnotation,
  activeTool,
  activeColor,
  zoom = 100,
  theme = 'dark',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const annotationCanvasRef = useRef<HTMLCanvasElement>(null);

  const [pdfDoc, setPdfDoc] = useState<unknown>(null);
  const [pageRendering, setPageRendering] = useState(false);
  const [pageSize, setPageSize] = useState<{ width: number; height: number }>({ width: 600, height: 800 });

  const isDrawingRef = useRef(false);
  const currentPathRef = useRef<{ x: number; y: number }[]>([]);

  // 1. Initialize PDF.js and load PDF Document
  useEffect(() => {
    let isCancelled = false;

    async function loadPdf() {
      try {
        const pdfjsLib = await import('pdfjs-dist');
        // Set worker source via unpkg CDN matching the installed version
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
          pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version || '4.0.0'}/build/pdf.worker.min.mjs`;
        }

        const typedPdfLib = pdfjsLib as unknown as {
          getDocument: (params: { url: string }) => { promise: Promise<{ numPages: number; getPage: (n: number) => Promise<unknown> }> };
        };

        const loadingTask = typedPdfLib.getDocument({ url: pdfData });
        const doc = await loadingTask.promise;
        if (!isCancelled) {
          setPdfDoc(doc);
          onTotalPagesChange(doc.numPages);
        }
      } catch (err) {
        console.error('Error loading PDF in PdfViewer:', err);
      }
    }

    if (pdfData) {
      loadPdf();
    }

    return () => {
      isCancelled = true;
    };
  }, [pdfData, onTotalPagesChange]);

  // 2. Render Current Page
  useEffect(() => {
    if (!pdfDoc || !pdfCanvasRef.current) return;

    let renderTask: { promise: Promise<void>; cancel: () => void } | null = null;
    let isCancelled = false;

    async function renderPage() {
      setPageRendering(true);
      try {
        const typedDoc = pdfDoc as {
          getPage: (n: number) => Promise<{
            getViewport: (opts: { scale: number }) => { width: number; height: number };
            render: (params: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void>; cancel: () => void };
          }>;
        };

        const page = await typedDoc.getPage(currentPage);
        if (isCancelled || !pdfCanvasRef.current) return;

        const scale = (zoom / 100) * 1.5;
        const viewport = page.getViewport({ scale });

        const canvas = pdfCanvasRef.current;
        const context = canvas.getContext('2d');
        if (!context) return;

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        setPageSize({ width: viewport.width, height: viewport.height });

        if (annotationCanvasRef.current) {
          annotationCanvasRef.current.width = viewport.width;
          annotationCanvasRef.current.height = viewport.height;
        }

        renderTask = page.render({
          canvasContext: context,
          viewport: viewport,
        });

        await renderTask.promise;
      } catch (err: unknown) {
        if ((err as { name?: string })?.name !== 'RenderingCancelledException') {
          console.error('Error rendering PDF page:', err);
        }
      } finally {
        if (!isCancelled) {
          setPageRendering(false);
        }
      }
    }

    renderPage();

    return () => {
      isCancelled = true;
      if (renderTask) {
        renderTask.cancel();
      }
    };
  }, [pdfDoc, currentPage, zoom]);

  // 3. Draw Annotations on Annotation Canvas
  const redrawAnnotations = useCallback(() => {
    const canvas = annotationCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const pageAnnotations = annotations.filter((a) => a.pageNumber === currentPage);

    for (const ann of pageAnnotations) {
      ctx.save();
      if (ann.type === 'highlight') {
        ctx.globalAlpha = 0.4;
        ctx.strokeStyle = ann.color || '#ffff00';
        ctx.lineWidth = ann.strokeWidth || 16;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
      } else {
        ctx.strokeStyle = ann.color || '#3b82f6';
        ctx.lineWidth = ann.strokeWidth || 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
      }

      if (ann.points && ann.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(ann.points[0]!.x, ann.points[0]!.y);
        for (let i = 1; i < ann.points.length; i++) {
          ctx.lineTo(ann.points[i]!.x, ann.points[i]!.y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }, [annotations, currentPage]);

  useEffect(() => {
    redrawAnnotations();
  }, [redrawAnnotations, pageSize]);

  // 4. Handle Mouse Drawing & Annotations
  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = annotationCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (activeTool === 'select') return;

    const coords = getCanvasCoords(e);

    if (activeTool === 'eraser') {
      // Find and remove clicked annotation on current page
      const found = annotations.find(
        (a) =>
          a.pageNumber === currentPage &&
          a.points?.some((p) => Math.hypot(p.x - coords.x, p.y - coords.y) < 20)
      );
      if (found) {
        onDeleteAnnotation(found.id);
      }
      return;
    }

    isDrawingRef.current = true;
    currentPathRef.current = [coords];
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || activeTool === 'select' || activeTool === 'eraser') return;

    const coords = getCanvasCoords(e);
    currentPathRef.current.push(coords);

    const canvas = annotationCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    if (activeTool === 'highlighter') {
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = activeColor || '#ffff00';
      ctx.lineWidth = 16;
    } else {
      ctx.strokeStyle = activeColor || '#3b82f6';
      ctx.lineWidth = 3;
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const points = currentPathRef.current;
    if (points.length > 1) {
      ctx.beginPath();
      ctx.moveTo(points[points.length - 2]!.x, points[points.length - 2]!.y);
      ctx.lineTo(points[points.length - 1]!.x, points[points.length - 1]!.y);
      ctx.stroke();
    }
    ctx.restore();
  };

  const handleMouseUp = () => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;

    if (currentPathRef.current.length > 1) {
      const newAnnotation: DocAnnotation = {
        id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        pageNumber: currentPage,
        type: activeTool === 'highlighter' ? 'highlight' : 'draw',
        color: activeColor,
        strokeWidth: activeTool === 'highlighter' ? 16 : 3,
        points: [...currentPathRef.current],
        createdAt: Date.now(),
      };
      onAddAnnotation(newAnnotation);
    }
    currentPathRef.current = [];
  };

  return (
    <div
      ref={containerRef}
      className="flex-1 flex flex-col items-center justify-start overflow-auto p-4 md:p-8 select-none"
    >
      <div
        className="relative rounded-xl overflow-hidden shadow-2xl transition-all"
        style={{
          border: theme === 'dark' ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid #cbd5e1',
          width: pageSize.width || 'auto',
          height: pageSize.height || 'auto',
          backgroundColor: '#ffffff',
        }}
      >
        {/* PDF Rendering Canvas */}
        <canvas ref={pdfCanvasRef} className="block" />

        {/* Annotation Layer Canvas */}
        <canvas
          ref={annotationCanvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          className={`absolute inset-0 ${
            activeTool === 'select'
              ? 'cursor-default'
              : activeTool === 'eraser'
              ? 'cursor-crosshair'
              : 'cursor-crosshair'
          }`}
        />

        {/* Loading overlay indicator */}
        {pageRendering && (
          <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px] flex items-center justify-center text-xs font-semibold text-white">
            Rendering Page...
          </div>
        )}
      </div>
    </div>
  );
};
