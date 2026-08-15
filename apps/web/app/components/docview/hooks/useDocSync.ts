import { useState, useEffect, useCallback, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { DocAnnotation, DocState } from '../types';
import { processUploadedFile } from '../lib/fileParser';
import {
  requestDocState,
  emitDocUpload,
  emitDocUpdate,
  emitAddAnnotation,
  emitDeleteAnnotation,
  emitClearAnnotations,
  emitCloseDocument,
} from '../net/emitters';

const INITIAL_DOC_STATE: DocState = {
  file: null,
  content: '',
  pdfData: null,
  docxData: null,
  pptxData: null,
  annotations: [],
  version: 0,
  lastUpdated: null,
  lastUpdatedBy: null,
};

export function useDocSync(socket: Socket | null) {
  const [docState, setDocState] = useState<DocState>(INITIAL_DOC_STATE);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Ref to hold the latest version to prevent race conditions during typing
  const versionRef = useRef(0);
  versionRef.current = docState.version;

  // Request initial document state when socket connects
  useEffect(() => {
    if (!socket) return;

    requestDocState(socket, (state) => {
      if (state) {
        setDocState(state);
      }
    });

    const handleDocLoaded = (state: DocState) => {
      setDocState(state);
    };

    const handleContentUpdated = ({
      content,
      version,
      updatedBy,
    }: {
      content: string;
      version: number;
      updatedBy: string;
    }) => {
      setDocState((prev) => ({
        ...prev,
        content,
        version,
        lastUpdated: Date.now(),
        lastUpdatedBy: updatedBy,
      }));
    };

    const handleAnnotationAdded = ({
      annotation,
      version,
    }: {
      annotation: DocAnnotation;
      version: number;
    }) => {
      setDocState((prev) => ({
        ...prev,
        annotations: [...prev.annotations, annotation],
        version,
        lastUpdated: Date.now(),
      }));
    };

    const handleAnnotationDeleted = ({
      id,
      version,
    }: {
      id: string;
      version: number;
    }) => {
      setDocState((prev) => ({
        ...prev,
        annotations: prev.annotations.filter((a) => a.id !== id),
        version,
        lastUpdated: Date.now(),
      }));
    };

    const handleAnnotationsCleared = ({ version }: { version: number }) => {
      setDocState((prev) => ({
        ...prev,
        annotations: [],
        version,
        lastUpdated: Date.now(),
      }));
    };

    const handleDocClosed = ({ version }: { version: number }) => {
      setDocState({
        ...INITIAL_DOC_STATE,
        version,
      });
    };

    socket.on('doc:loaded', handleDocLoaded);
    socket.on('doc:contentUpdated', handleContentUpdated);
    socket.on('doc:annotationAdded', handleAnnotationAdded);
    socket.on('doc:annotationDeleted', handleAnnotationDeleted);
    socket.on('doc:annotationsCleared', handleAnnotationsCleared);
    socket.on('doc:closed', handleDocClosed);

    return () => {
      socket.off('doc:loaded', handleDocLoaded);
      socket.off('doc:contentUpdated', handleContentUpdated);
      socket.off('doc:annotationAdded', handleAnnotationAdded);
      socket.off('doc:annotationDeleted', handleAnnotationDeleted);
      socket.off('doc:annotationsCleared', handleAnnotationsCleared);
      socket.off('doc:closed', handleDocClosed);
    };
  }, [socket]);

  const uploadDocument = useCallback(
    async (file: File) => {
      if (!socket) return;

      const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
      if (file.size > MAX_FILE_SIZE) {
        setUploadError(`File is too large. Maximum supported size is 25MB.`);
        return;
      }

      setIsUploading(true);
      setUploadError(null);
      try {
        const { fileInfo, content, pdfData, docxData, pptxData } = await processUploadedFile(file);
        emitDocUpload(socket, { file: fileInfo, content, pdfData, docxData, pptxData });
      } catch (err: unknown) {
        console.error('Document upload error:', err);
        setUploadError((err as Error)?.message || 'Failed to process document');
      } finally {
        setIsUploading(false);
      }
    },
    [socket]
  );

  const updateContent = useCallback(
    (newContent: string) => {
      if (!socket) return;
      setDocState((prev) => ({ ...prev, content: newContent }));
      emitDocUpdate(socket, {
        content: newContent,
        clientVersion: versionRef.current,
      });
    },
    [socket]
  );

  const addAnnotation = useCallback(
    (annotation: DocAnnotation) => {
      if (!socket) return;
      setDocState((prev) => ({
        ...prev,
        annotations: [...prev.annotations, annotation],
      }));
      emitAddAnnotation(socket, annotation);
    },
    [socket]
  );

  const deleteAnnotation = useCallback(
    (id: string) => {
      if (!socket) return;
      setDocState((prev) => ({
        ...prev,
        annotations: prev.annotations.filter((a) => a.id !== id),
      }));
      emitDeleteAnnotation(socket, id);
    },
    [socket]
  );

  const clearAnnotations = useCallback(() => {
    if (!socket) return;
    setDocState((prev) => ({ ...prev, annotations: [] }));
    emitClearAnnotations(socket);
  }, [socket]);

  const closeDocument = useCallback(() => {
    if (!socket) return;
    setDocState(INITIAL_DOC_STATE);
    emitCloseDocument(socket);
  }, [socket]);

  return {
    docState,
    isUploading,
    uploadError,
    uploadDocument,
    updateContent,
    addAnnotation,
    deleteAnnotation,
    clearAnnotations,
    closeDocument,
  };
}
