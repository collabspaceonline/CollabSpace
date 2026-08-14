export type DocType = 'docx' | 'doc' | 'pdf' | 'text';

export interface DocFileInfo {
  name: string;
  type: DocType;
  size: number;
  lastModified?: number;
}

export type AnnotationType = 'draw' | 'highlight' | 'note' | 'text';

export interface DocAnnotation {
  id: string;
  pageNumber: number;
  type: AnnotationType;
  color: string;
  strokeWidth?: number;
  points?: { x: number; y: number }[];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  text?: string;
  author?: string;
  createdAt?: number;
}

export interface DocState {
  file: DocFileInfo | null;
  content: string;
  pdfData: string | null;
  annotations: DocAnnotation[];
  version: number;
  lastUpdated?: number | null;
  lastUpdatedBy?: string | null;
}

export type AnnotationTool = 'select' | 'pen' | 'highlighter' | 'note' | 'eraser';

export interface DocCursorPosition {
  socketId: string;
  x: number;
  y: number;
  pageNumber?: number;
}
