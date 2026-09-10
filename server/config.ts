export interface ServerConfig {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  trustedProxyCidrs: string[];
  directDeployment: boolean;
  requireTrustedProxy: boolean;
  diagnosticModelsEnabled: boolean;
  adminDiagnosticToken: string;
  ocrRateLimitPerMinute: number;
  ocrRateLimitWindowMs: number;
  maxSingleImageBytes: number;
  maxTotalImagesBytes: number;
  maxRawPayloadBytes: number;
  maxImagesPerRequest: number;
  maxImageDimension: number;
  maxImagePixels: number;
  maxGlobalConcurrentWork: number;
  allowExternalViteHost: boolean;
  debugMetrics: boolean;
  productionSourcemaps: boolean;
  frameAncestors: string;
  geminiApiKey: string;
}

function parsePort(raw: string | undefined): number {
  if (raw == null || raw.trim() === '') return 3000;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT value: ${raw}. PORT must be an integer from 1 to 65535.`);
  }
  return port;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`Expected a positive integer, received: ${raw}`);
  return value;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null || raw.trim() === '') return fallback;
  return raw.trim().toLowerCase() === 'true';
}

let activeConfig: ServerConfig | null = null;

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const nodeEnv = env.NODE_ENV === 'production' ? 'production' : env.NODE_ENV === 'test' ? 'test' : 'development';
  const trustedProxyCidrs = String(env.TRUSTED_PROXY_CIDRS || '').split(',').map((v) => v.trim()).filter(Boolean);
  const directDeployment = parseBoolean(env.DIRECT_DEPLOYMENT, false);
  const requireTrustedProxy = parseBoolean(env.REQUIRE_TRUSTED_PROXY, nodeEnv === 'production' && !directDeployment);
  if (nodeEnv === 'production' && requireTrustedProxy && trustedProxyCidrs.length === 0) {
    throw new Error('TRUSTED_PROXY_CIDRS must be configured for production proxy deployments. Set DIRECT_DEPLOYMENT=true only when the server is directly exposed.');
  }

  return {
    nodeEnv,
    port: parsePort(env.PORT),
    trustedProxyCidrs,
    directDeployment,
    requireTrustedProxy,
    diagnosticModelsEnabled: parseBoolean(env.ENABLE_DIAGNOSTIC_MODELS_ENDPOINT, nodeEnv !== 'production'),
    adminDiagnosticToken: String(env.ADMIN_DIAGNOSTIC_TOKEN || '').trim(),
    ocrRateLimitPerMinute: parsePositiveInt(env.OCR_RATE_LIMIT_PER_MINUTE, 8),
    ocrRateLimitWindowMs: 60_000,
    maxSingleImageBytes: 50 * 1024 * 1024,
    maxTotalImagesBytes: 120 * 1024 * 1024,
    maxRawPayloadBytes: 162 * 1024 * 1024,
    maxImagesPerRequest: 30,
    maxImageDimension: 12_000,
    maxImagePixels: 60_000_000,
    maxGlobalConcurrentWork: 8,
    allowExternalViteHost: parseBoolean(env.VITE_ALLOW_EXTERNAL_HOST, false),
    debugMetrics: parseBoolean(env.DEBUG_METRICS, false),
    productionSourcemaps: parseBoolean(env.PRODUCTION_SOURCEMAPS, false),
    frameAncestors: String(env.FRAME_ANCESTORS || "'self'").trim() || "'self'",
    geminiApiKey: String(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || '').trim(),
  };
}

export function setServerConfig(config: ServerConfig): void { activeConfig = config; }
export function getServerConfig(): ServerConfig { if (!activeConfig) throw new Error('Server configuration has not been initialized.'); return activeConfig; }
