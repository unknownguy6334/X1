/** Lightweight browser-side file identity helpers used by the screenshot workspace. */

const FINGERPRINT_SIZE = 16;
const HASH_CHUNK_BYTES = 2 * 1024 * 1024;
const HASH_FULL_FILE_MAX_BYTES = 8 * 1024 * 1024;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256File(file: File): Promise<string | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null;
  try {
    // Preserve the traditional exact-file SHA-256 for small inputs. Large screenshots use
    // a deterministic chunk-digest envelope so hashing never requires the whole file in memory.
    if (file.size <= HASH_FULL_FILE_MAX_BYTES) {
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      return toHex(new Uint8Array(digest));
    }
    const chunkDigests: Uint8Array[] = [];
    for (let offset = 0; offset < file.size; offset += HASH_CHUNK_BYTES) {
      const digest = await crypto.subtle.digest('SHA-256', await file.slice(offset, Math.min(file.size, offset + HASH_CHUNK_BYTES)).arrayBuffer());
      chunkDigests.push(new Uint8Array(digest));
    }
    const envelope = new Uint8Array(chunkDigests.length * 32);
    chunkDigests.forEach((digest, index) => envelope.set(digest, index * 32));
    const finalDigest = await crypto.subtle.digest('SHA-256', envelope);
    return `chunked-v1:${file.size}:${toHex(new Uint8Array(finalDigest))}`;
  } catch {
    return null;
  }
}

/**
 * Produces a deliberately small visual fingerprint. It is only a similarity hint,
 * never an identity key, because two screenshots can legitimately be very similar.
 */
export async function visualFingerprint(file: File): Promise<string | null> {
  if (typeof window === 'undefined' || typeof window.createImageBitmap !== 'function') return null;

  try {
    const bitmap = await window.createImageBitmap(file, {
      resizeWidth: FINGERPRINT_SIZE,
      resizeHeight: FINGERPRINT_SIZE,
      resizeQuality: 'low',
    });
    try {
      const canvas = document.createElement('canvas');
      canvas.width = FINGERPRINT_SIZE;
      canvas.height = FINGERPRINT_SIZE;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, FINGERPRINT_SIZE, FINGERPRINT_SIZE);
      const pixels = ctx.getImageData(0, 0, FINGERPRINT_SIZE, FINGERPRINT_SIZE).data;
      let total = 0;
      const grayscale = new Array<number>(FINGERPRINT_SIZE * FINGERPRINT_SIZE);
      for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
        const value = Math.round((pixels[i] * 299 + pixels[i + 1] * 587 + pixels[i + 2] * 114) / 1000);
        grayscale[p] = value;
        total += value;
      }
      const average = total / grayscale.length;
      return grayscale.map((value) => value >= average ? '1' : '0').join('');
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}

export function fingerprintDistance(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b || a.length !== b.length) return null;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) distance++;
  }
  return distance;
}
