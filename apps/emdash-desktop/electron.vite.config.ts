import { cp, rm } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { desktopWorkers } from './src/core/manifests/node/workers';

function desktopWorkerBuildInputs(): Record<string, string> {
  return Object.fromEntries(
    Object.values(desktopWorkers).map((worker) => [
      basename(worker.file, extname(worker.file)),
      resolve(worker.entry),
    ])
  );
}

function copyAdapterAssetsPlugin() {
  return {
    name: 'copy-plugin-adapter-assets',
    async closeBundle(): Promise<void> {
      const source = resolve('../../packages/plugins/dist/adapters');
      const target = resolve('out/main/adapters');
      try {
        await rm(target, { recursive: true, force: true });
        await cp(source, target, { recursive: true });
      } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') return;
        throw error;
      }
    },
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

// Workspace packages must be bundled (not externalized) in main/preload builds:
// externalized modules are resolved by Node at runtime, where the `development`
// export condition is off, so dev runs would silently load stale dists.
const workspacePackages = [
  '@emdash/chat-ui',
  '@emdash/core',
  '@emdash/plugins',
  '@emdash/shared',
  '@emdash/theme',
  '@emdash/ui',
  '@emdash/wire',
];

export default defineConfig({
  main: {
    root: 'src/main',
    envDir: resolve('.'),
    plugins: [copyAdapterAssetsPlugin()],
    // formidable (bundled via @emdash/plugins -> asana) reassigns `require`
    // behind a `global.GENTLY` guard, which Rollup rejects. Defining it false
    // makes the branch dead code so the bundle builds.
    define: {
      'global.GENTLY': 'false',
    },
    build: {
      externalizeDeps: {
        // [XG-CUSTOM] zod 加进 exclude：monorepo hoist 把 zod 嵌套到 @emdash/core/node_modules，
        // 顶层 external 解析不到 → AppImage 报 Cannot find package 'zod'。bundle 进产物根治。
        exclude: [...workspacePackages, 'zod', 'electron-updater', 'human-id', 'nbranch'],
      },
      rollupOptions: {
        input: {
          index: resolve('src/entry/main.ts'),
          ...desktopWorkerBuildInputs(),
        },
        output: {
          entryFileNames: '[name].js',
        },
      },
    },
    resolve: {
      alias: {
        '@': resolve('src'),
        '@core': resolve('src/core'),
        '@main': resolve('src/main'),
        '@root': resolve('.'),
      },
    },
  },
  preload: {
    root: 'src/entry',
    build: {
      externalizeDeps: {
        // [XG-CUSTOM] zod 加进 exclude：monorepo hoist 把 zod 嵌套到 @emdash/core/node_modules，
        // 顶层 external 解析不到 → AppImage 报 Cannot find package 'zod'。bundle 进产物根治。
        exclude: [...workspacePackages, 'zod', 'electron-updater', 'human-id', 'nbranch'],
      },
      rollupOptions: {
        input: {
          index: resolve('src/entry/preload.ts'),
        },
      },
    },
    resolve: {
      alias: {
        '@root': resolve('.'),
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          // [XG-CUSTOM] 第二个入口：项我控制球页面（球 + 面板 + 聊天 UI，移植自 deepseek-harness-orb）。
          // 生产产物 = out/renderer/orb/orb.html（主进程按 app://<app>/orb/orb.html 加载）；
          // dev = http://localhost:3000/orb/orb.html。
          index: resolve('src/renderer/index.html'),
          orb: resolve('src/renderer/orb/orb.html'),
        },
      },
    },
    resolve: {
      alias: {
        '@': resolve('src'),
        '@core': resolve('src/core'),
        '@renderer': resolve('src/renderer'),
        '@root': resolve('.'),
        // cli-agent-plugins metadata/icons chunks transitively reference node:buffer
        // (through hook-config helpers bundled in the same tsdown chunk), even though
        // those helpers never run in the renderer. Alias to the browser-safe polyfill.
        'node:buffer': 'buffer',
      },
    },
    server: {
      port: 3000,
    },
  },
});
