import { build } from 'esbuild';

const production = process.env.NODE_ENV === 'production';
const sourcemap = process.env.PRODUCTION_SOURCEMAPS === 'true' || (!production && process.env.SOURCEMAP === 'true');

await build({
  entryPoints: ['server.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  sourcemap,
  outfile: 'dist/server.cjs',
});
