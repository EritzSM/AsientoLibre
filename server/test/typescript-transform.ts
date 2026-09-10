import ts from 'typescript';
import type { Plugin } from 'vite';

/** Nest relies on the same decorator metadata emitted by tsc in production. */
export function nestTypescript(): Plugin {
  return {
    name: 'nest-typescript-metadata',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('.ts') || id.includes('/node_modules/')) return null;
      const result = ts.transpileModule(code, {
        fileName: id,
        compilerOptions: {
          target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext,
          experimentalDecorators: true, emitDecoratorMetadata: true,
          esModuleInterop: true, sourceMap: true,
        },
      });
      return { code: result.outputText, map: result.sourceMapText };
    },
  };
}
