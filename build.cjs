const { build } = require('esbuild');

async function main() {
  // Build server
  await build({
    entryPoints: ['src/server/index.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: 'lib/src/server/index.cjs',
    external: ['@deepseek-ai/cordis', 'node:http', 'node:stream'],
  });

  // Build client
  await build({
    entryPoints: ['src/client/index.tsx'],
    bundle: true,
    platform: 'browser',
    format: 'cjs',
    outfile: 'lib/client.cjs',
    external: ['react', '@deepseek-ai/*'],
  });

  // Wrap client in ModuleLoader
  const clientCode = await require('fs').promises.readFile('lib/client.cjs', 'utf8');
  const wrappedClient = `window.__ModuleLoader__.load({ id: 'dsh-telegram', factory(require) { ${clientCode} } });`;
  await require('fs').promises.writeFile('lib/client.js', wrappedClient, 'utf8');

  console.log('Build completed successfully');
}

main().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});