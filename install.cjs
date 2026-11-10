try {
  require('./scripts/dependencies.cjs').ensureDependencies({ noDownload: process.argv.includes('--no-download') });
  require('./scripts/setup.cjs').main('install');
} catch (error) { console.error('NotDex: ' + error.message); process.exitCode = 1; }
