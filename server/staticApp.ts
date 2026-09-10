import express, { type Express } from 'express';
import path from 'node:path';
import type { ServerConfig } from './config';

export async function configureFrontendServing(app: Express, config: ServerConfig): Promise<void> {
  if (config.nodeEnv !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true, allowedHosts: config.allowExternalViteHost ? true : ['localhost', '127.0.0.1'] }, appType: 'spa' });
    app.use(vite.middlewares);
    return;
  }

  const distPath = path.resolve(process.cwd(), 'dist');
  app.use((req, res, next) => {
    if (/\.map$/i.test(req.path) || /(^|\/)server\.cjs$/i.test(req.path)) return res.status(404).end();
    next();
  });
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    const accept = String(req.headers.accept || '');
    const isDocumentNavigation = accept.split(',').map((part) => part.split(';')[0].trim()).includes('text/html');
    const hasAssetExtension = /\.[a-z0-9]{1,12}$/i.test(req.path);
    if (!isDocumentNavigation || hasAssetExtension || req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}
