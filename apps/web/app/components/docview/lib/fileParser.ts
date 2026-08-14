import mammoth from 'mammoth';
import { DocFileInfo, DocType } from '../types';

export function getDocType(fileName: string): DocType {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (ext === 'docx') return 'docx';
  if (ext === 'doc') return 'doc';
  return 'text';
}

export async function parseDocx(arrayBuffer: ArrayBuffer): Promise<string> {
  try {
    const result = await mammoth.convertToHtml({ arrayBuffer });
    return result.value || '<p></p>';
  } catch (error) {
    console.error('Failed to parse docx via mammoth:', error);
    // Fallback: extract plain text
    try {
      const textResult = await mammoth.extractRawText({ arrayBuffer });
      return `<p>${(textResult.value || '').replace(/\n/g, '<br/>')}</p>`;
    } catch {
      return '<p>Error loading Word document content. The file might be corrupted or legacy binary format.</p>';
    }
  }
}

export function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export async function processUploadedFile(file: File): Promise<{
  fileInfo: DocFileInfo;
  content: string;
  pdfData: string | null;
}> {
  const docType = getDocType(file.name);
  const fileInfo: DocFileInfo = {
    name: file.name,
    type: docType,
    size: file.size,
    lastModified: file.lastModified,
  };

  if (docType === 'pdf') {
    const dataUrl = await readFileAsDataURL(file);
    return {
      fileInfo,
      content: '',
      pdfData: dataUrl,
    };
  }

  if (docType === 'docx' || docType === 'doc') {
    const buffer = await readFileAsArrayBuffer(file);
    const html = await parseDocx(buffer);
    return {
      fileInfo,
      content: html,
      pdfData: null,
    };
  }

  // Text files
  const text = await readFileAsText(file);
  return {
    fileInfo,
    content: `<p>${text.replace(/\n/g, '<br/>')}</p>`,
    pdfData: null,
  };
}
