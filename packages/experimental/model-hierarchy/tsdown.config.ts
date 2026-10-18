import { defineConfig } from 'tsdown'

/** Build the hierarchy Host runtime as one ESM export. */
export default defineConfig([{ entry: ['src/index.ts'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024', fixedExtension: false, dts: false, clean: false }])
