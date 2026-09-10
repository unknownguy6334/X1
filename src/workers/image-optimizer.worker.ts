import { IMAGE_OPTIMIZATION_POLICY as POLICY } from '../utils/imageOptimizationPolicy';

const MAX_DIM = POLICY.maxDimension;
const MAX_SOURCE_PIXELS = POLICY.maxSourcePixels;
const LOW_RESOLUTION_MAX_DIM = POLICY.lowResolutionMaxDimension;

self.onmessage = async (event: MessageEvent) => {
  if (event.data?.type === 'CAPABILITY_CHECK') {
    const supported = typeof createImageBitmap === 'function' && typeof OffscreenCanvas === 'function';
    self.postMessage({ type: 'CAPABILITY', supported });
    return;
  }

  try {
    const { buffer, source, target, quality } = event.data || {};
    const blob = source instanceof Blob ? source : (buffer instanceof ArrayBuffer ? new Blob([buffer]) : null);
    if (!blob) throw new Error('Invalid image data.');
    const bitmap = await createImageBitmap(blob, {
      imageOrientation: 'from-image',
      resizeWidth: target?.width || MAX_DIM,
      resizeQuality: 'high',
    });

    try {
      if (!Number.isFinite(bitmap.width) || !Number.isFinite(bitmap.height) || bitmap.width <= 0 || bitmap.height <= 0) {
        throw new Error('The selected image has invalid dimensions.');
      }
      if (bitmap.width * bitmap.height > MAX_SOURCE_PIXELS) {
        throw new Error('This screenshot is too large to read. Try a smaller screenshot or crop it, then try again.');
      }

      let width = bitmap.width;
      let height = bitmap.height;
      if (width > MAX_DIM || height > MAX_DIM) {
        if (width >= height) {
          height = Math.max(1, Math.round((height * MAX_DIM) / width));
          width = MAX_DIM;
        } else {
          width = Math.max(1, Math.round((width * MAX_DIM) / height));
          height = MAX_DIM;
        }
      }
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('We couldn’t prepare this screenshot. Try it again.');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, width, height);

      const encoded = await canvas.convertToBlob({ type: 'image/jpeg', quality: quality ?? POLICY.workerJpegQuality });
      const bytes = new Uint8Array(await encoded.arrayBuffer());
      let binary = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      const base64 = btoa(binary);
      self.postMessage({
        ok: true,
        value: {
          base64,
          mimeType: 'image/jpeg',
          sourceWidth: bitmap.width,
          sourceHeight: bitmap.height,
          warning: (bitmap.width < LOW_RESOLUTION_MAX_DIM && bitmap.height < LOW_RESOLUTION_MAX_DIM)
            ? `This image is very low resolution (${bitmap.width}×${bitmap.height}). A higher-resolution screenshot is recommended for reliable OCR.`
            : undefined,
        },
      });
    } finally {
      bitmap.close();
    }
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : 'Image worker failed.' });
  }
};
