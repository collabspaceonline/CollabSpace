const { getRoomForSocket } = require('../../rooms/roomStore');

/**
 * Authoritative document state (`room.document`) — handling .doc/.docx rich text
 * and .pdf documents with multi-user synchronization and annotations.
 */
function registerDocumentHandlers(io, socket) {
  /**
   * doc:getState — called when a user switches to Document view.
   */
  socket.on('doc:getState', (callback) => {
    const room = getRoomForSocket(socket);
    if (!room) {
      return callback?.({
        file: null,
        content: '',
        pdfData: null,
        annotations: [],
        version: 0,
      });
    }
    callback?.(room.document);
  });

  /**
   * doc:upload — a user uploads a new .doc, .docx, or .pdf file.
   */
  socket.on('doc:upload', ({ file, content = '', pdfData = null }) => {
    const room = getRoomForSocket(socket);
    if (!room || !file) return;

    room.document.version += 1;
    room.document.file = file;
    room.document.content = content;
    room.document.pdfData = pdfData;
    room.document.annotations = [];
    room.document.lastUpdated = Date.now();
    room.document.lastUpdatedBy = socket.id;

    // Broadcast to everyone in the room (including sender to confirm server sync)
    io.to(socket.roomId).emit('doc:loaded', room.document);
  });

  /**
   * doc:updateContent — a user edits the rich text document content.
   */
  socket.on('doc:updateContent', ({ content, clientVersion }) => {
    const room = getRoomForSocket(socket);
    if (!room || typeof content !== 'string') return;

    // Version increment
    room.document.version += 1;
    room.document.content = content;
    room.document.lastUpdated = Date.now();
    room.document.lastUpdatedBy = socket.id;

    // Broadcast to peers (sender applied optimistically)
    socket.to(socket.roomId).emit('doc:contentUpdated', {
      content,
      version: room.document.version,
      updatedBy: socket.id,
    });
  });

  /**
   * doc:addAnnotation — a user drew, highlighted, or added a note to a PDF page.
   */
  socket.on('doc:addAnnotation', ({ annotation }) => {
    const room = getRoomForSocket(socket);
    if (!room || !annotation?.id) return;

    room.document.version += 1;
    room.document.annotations.push(annotation);
    room.document.lastUpdated = Date.now();

    // Broadcast to peers
    socket.to(socket.roomId).emit('doc:annotationAdded', {
      annotation,
      version: room.document.version,
    });
  });

  /**
   * doc:deleteAnnotation — a user removed an annotation.
   */
  socket.on('doc:deleteAnnotation', ({ id }) => {
    const room = getRoomForSocket(socket);
    if (!room || !id) return;

    room.document.version += 1;
    room.document.annotations = room.document.annotations.filter((a) => a.id !== id);

    io.to(socket.roomId).emit('doc:annotationDeleted', {
      id,
      version: room.document.version,
    });
  });

  /**
   * doc:clearAnnotations — clear all annotations from current document.
   */
  socket.on('doc:clearAnnotations', () => {
    const room = getRoomForSocket(socket);
    if (!room) return;

    room.document.version += 1;
    room.document.annotations = [];

    io.to(socket.roomId).emit('doc:annotationsCleared', {
      version: room.document.version,
    });
  });

  /**
   * doc:cursorMove — live pointer or selection position inside the document.
   */
  socket.on('doc:cursorMove', (data) => {
    if (!socket.roomId) return;
    socket.to(socket.roomId).emit('doc:cursorMove', {
      socketId: socket.id,
      ...data,
    });
  });

  /**
   * doc:closeDocument — close the document for everyone.
   */
  socket.on('doc:closeDocument', () => {
    const room = getRoomForSocket(socket);
    if (!room) return;

    room.document.file = null;
    room.document.content = '';
    room.document.pdfData = null;
    room.document.annotations = [];
    room.document.version += 1;

    io.to(socket.roomId).emit('doc:closed', {
      version: room.document.version,
    });
  });
}

module.exports = { registerDocumentHandlers };
