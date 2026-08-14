import { Socket } from 'socket.io-client';
import { DocAnnotation, DocFileInfo, DocState } from '../types';

export function requestDocState(
  socket: Socket,
  callback: (state: DocState) => void
) {
  socket.emit('doc:getState', callback);
}

export function emitDocUpload(
  socket: Socket,
  payload: {
    file: DocFileInfo;
    content: string;
    pdfData: string | null;
  }
) {
  socket.emit('doc:upload', payload);
}

export function emitDocUpdate(
  socket: Socket,
  payload: {
    content: string;
    clientVersion: number;
  }
) {
  socket.emit('doc:updateContent', payload);
}

export function emitAddAnnotation(
  socket: Socket,
  annotation: DocAnnotation
) {
  socket.emit('doc:addAnnotation', { annotation });
}

export function emitDeleteAnnotation(
  socket: Socket,
  id: string
) {
  socket.emit('doc:deleteAnnotation', { id });
}

export function emitClearAnnotations(socket: Socket) {
  socket.emit('doc:clearAnnotations');
}

export function emitCloseDocument(socket: Socket) {
  socket.emit('doc:closeDocument');
}

export function emitDocCursor(
  socket: Socket,
  data: { x: number; y: number; pageNumber?: number }
) {
  socket.emit('doc:cursorMove', data);
}
