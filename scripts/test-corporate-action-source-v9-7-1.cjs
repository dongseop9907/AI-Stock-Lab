const ts = require('typescript');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-source-test-'));
try {
  const program = ts.createProgram([path.join(root, 'tests/opendart-source-v9-7-1.test.ts')], {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.Node16,
    moduleResolution: ts.ModuleResolutionKind.Node16, esModuleInterop: true,
    strict: true, skipLibCheck: true, noEmitOnError: true, outDir: output,
    types: ['node'], typeRoots: [path.join(root, 'node_modules/@types')],
  });
  const result = program.emit();
  const errors = ts.getPreEmitDiagnostics(program).concat(result.diagnostics);
  if (errors.length) {
    console.error(ts.formatDiagnosticsWithColorAndContext(errors, {
      getCanonicalFileName: f => f, getCurrentDirectory: () => root, getNewLine: () => '\n',
    }));
    process.exitCode = 1;
  } else {
    const test = cp.spawnSync(process.execPath, ['--test', path.join(output, 'tests/opendart-source-v9-7-1.test.js')], { stdio: 'inherit' });
    process.exitCode = test.status ?? 1;
  }
} finally { fs.rmSync(output, { recursive: true, force: true }); }
