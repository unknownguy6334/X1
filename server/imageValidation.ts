import { Buffer } from 'node:buffer';

export interface ImageDimensions {
  width: number;
  height: number;
}

const JPEG_HEADER_SCAN_BYTES = 4 * 1024 * 1024;

function decodeHeader(base64Str: string, maxBytes: number): Buffer {
  const clean = base64Str.replace(/^data:[^,]+,/, '').replace(/\s+/g, '');
  const maxBase64Chars = Math.ceil(maxBytes / 3) * 4;
  return Buffer.from(clean.slice(0, maxBase64Chars), 'base64');
}

function jpegDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker === 0xda) break;
    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) break;
    const isSof = (marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf);
    if (isSof && offset + 7 <= buffer.length) {
      return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  return null;
}

export function detectImageDimensions(base64Str: string, mime: string, decodedByteLength: number): ImageDimensions | null {
  try {
    // PNG/WEBP dimensions live in fixed headers, so never decode the entire image.
    const buffer = decodeHeader(base64Str, 256);
    if (mime === 'image/png' && buffer.length >= 24) {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (mime === 'image/webp' && buffer.length >= 30) {
      const chunk = buffer.toString('ascii', 12, 16);
      if (chunk === 'VP8X') return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
      if (chunk === 'VP8 ') return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') {
        const b1 = buffer[21], b2 = buffer[22], b3 = buffer[23], b4 = buffer[24];
        return { width: 1 + (b1 | ((b2 & 0x3f) << 8)), height: 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10)) };
      }
    }
    if (mime === 'image/jpeg') {
      const header = decodeHeader(base64Str, JPEG_HEADER_SCAN_BYTES);
      const parsed = jpegDimensions(header);
      if (parsed) return parsed;
      // A long APP/metadata prefix can place SOF beyond the normal header scan. Decode fully only
      // for small JPEGs; rejecting an oversized, structurally uninspectable JPEG is safer than
      // allocating another large copy just to discover dimensions.
      if (decodedByteLength <= JPEG_HEADER_SCAN_BYTES) return jpegDimensions(Buffer.from(base64Str.replace(/^data:[^,]+,/, ''), 'base64'));
    }
  } catch {
    return null;
  }
  return null;
}
