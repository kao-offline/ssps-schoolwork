import { extractRawText } from 'mammoth';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { convert } from 'html-to-text';
import { boundedBytes } from './http.js';
import { attachment } from './bakalari.js';

export type DocumentPart = { reference: string; text: string };
export function plain(html: string) { return convert(html, { wordwrap: false, limits: { maxInputLength: 1_000_000 } }); }
export function filename(header: string | null) {
  const encoded = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) { try { return decodeURIComponent(encoded); } catch { /* Fall back to plain filename. */ } }
  return header?.match(/filename="([^"]+)"/i)?.[1] || header?.match(/filename=([^;]+)/i)?.[1]?.trim() || 'attachment';
}
export async function extract(bytes: Buffer, name: string, mime: string): Promise<DocumentPart[]> {
  const extension = name.split('.').at(-1)?.toLowerCase();
  if (extension === 'pdf' || mime.includes('pdf')) {
    const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
    const pdf = await task.promise;
    try {
      if (pdf.numPages > 300) throw new Error('PDF exceeds the 300 page limit.');
      const parts: DocumentPart[] = [];
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number);
        const content = await page.getTextContent();
        parts.push({ reference: `page ${number}`, text: content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim() });
      }
      return parts;
    } finally { await task.destroy(); }
  }
  if (extension === 'docx' || mime.includes('wordprocessingml')) {
    checkArchive(bytes);
    const result = await extractRawText({ buffer: bytes });
    return [{ reference: 'document text (page layout unavailable)', text: result.value }];
  }
  if (extension === 'pptx' || mime.includes('presentationml')) {
    const files = checkArchive(bytes);
    const parser = new XMLParser({ ignoreAttributes: true, trimValues: false });
    function textNodes(value: any): string[] {
      if (!value || typeof value !== 'object') return [];
      return Object.entries(value).flatMap(([key, child]) => key === 'a:t' ? [String(child)] : Array.isArray(child) ? child.flatMap(textNodes) : textNodes(child));
    }
    const slides = Object.keys(files).filter(key => /^ppt\/slides\/slide\d+\.xml$/.test(key)).sort((a, b) => Number(a.match(/slide(\d+)/)?.[1]) - Number(b.match(/slide(\d+)/)?.[1]));
    return slides.map((key, i) => ({ reference: `slide ${i + 1}`, text: textNodes(parser.parse(strFromU8(files[key]))).join('\n') }));
  }
  if (['txt', 'md', 'csv', 'json', 'html', 'htm', 'xml', 'py', 'js', 'ts', 'css'].includes(extension || '') || mime.startsWith('text/')) {
    const text = bytes.toString('utf8');
    return [{ reference: 'file text', text: extension === 'html' || extension === 'htm' || mime.includes('html') ? plain(text) : text }];
  }
  throw new Error('Unsupported document type. Supported: PDF, DOCX, PPTX and text. Images/scanned PDFs require separate OCR.');
}
function checkArchive(bytes: Buffer) {
  let expanded = 0;
  const files = unzipSync(bytes, { filter: file => {
    expanded += file.originalSize;
    if (expanded > 50 * 1024 * 1024) throw new Error('Office document exceeds the 50 MiB expanded limit.');
    return true;
  } });
  return files;
}
export async function readBakDocument(id: string) {
  const response = await attachment(id);
  const name = filename(response.headers.get('content-disposition'));
  return { name, attachmentId: id, parts: await extract(await boundedBytes(response), name, response.headers.get('content-type') || '') };
}
export function documentWindow(document: { parts: DocumentPart[] }, offset: number, limit: number) {
  let position = 0;
  let total = 0;
  const parts = [];
  for (const part of document.parts) {
    const start = total;
    total += part.text.length;
    const left = Math.max(0, offset - start);
    const right = Math.min(part.text.length, offset + limit - start);
    if (right > left) { parts.push({ ...part, text: part.text.slice(left, right) }); position += right - left; }
  }
  return { ...document, parts, totalCharacters: total, nextOffset: offset + position < total ? offset + position : null, emptyText: total === 0 };
}
