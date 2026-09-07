const CopyPlugin = require("copy-webpack-plugin");
const withPWA = require("@ducanh2912/next-pwa").default({
  dest: "public",
  /*
   * kamiko.fun ships as a single-page consumer site with no offline PWA. An earlier build registered
   * a workbox precache service worker that could keep serving a STALE app shell (old navigation) to
   * returning browsers. For that deploy we set NEXT_PUBLIC_KILL_SW=true, which DISABLES next-pwa so
   * no workbox SW is generated; the deploy then drops a self-destructing kill-switch at /sw.js
   * (killswitch-sw.js) that unregisters the old SW, purges its caches, and reloads open tabs. The
   * full-stack build (push/streak-saver) leaves this unset and keeps the customWorker SW below.
   */
  disable: process.env.NEXT_PUBLIC_KILL_SW === "true",
  /*
   * The $KAMIKO streak-saver push handlers. next-pwa compiles worker/index.js and imports it into the
   * service worker it generates, so the push/notificationclick listeners ship INSIDE the same
   * /sw.js that already does amica's offline caching.
   *
   * They cannot simply be a hand-written public/sw.js: `dest: "public"` means the build OVERWRITES
   * that file, so the worker would work in development and silently disappear in production. And
   * they cannot be a second worker registered at '/', because registering another script at the
   * same scope replaces amica's PWA registration outright.
   */
  customWorkerSrc: "worker",
});

const output = process.env.NEXT_OUTPUT || undefined;

/** @type {import('next').NextConfig} */
const nextConfig = {
  output,
  reactStrictMode: false,
  assetPrefix: process.env.BASE_PATH || "",
  basePath: process.env.BASE_PATH || "",
  trailingSlash: true,
  publicRuntimeConfig: {
    root: process.env.BASE_PATH || "",
  },
  optimizeFonts: false,
  webpack: (config, { webpack, buildId }) => {
    // See https://webpack.js.org/configuration/resolve/#resolvealias
    config.resolve.alias = {
      ...config.resolve.alias,
      sharp$: false,
      "onnxruntime-node$": false,
    };

    config.plugins.push(
      new CopyPlugin({
        patterns: [
          {
            from: "./node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm",
            to: "static/chunks/[name][ext]",
          },
          {
            from: "./node_modules/onnxruntime-web/dist/ort-wasm-threaded.wasm",
            to: "static/chunks/[name][ext]",
          },
          {
            from: "./node_modules/onnxruntime-web/dist/ort-wasm.wasm",
            to: "static/chunks/[name][ext]",
          },
          {
            from: "./node_modules/onnxruntime-web/dist/ort-wasm-simd.wasm",
            to: "static/chunks/[name][ext]",
          },
          {
            from: "node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js",
            to: "static/chunks/[name][ext]",
          },
          {
            from: "node_modules/@ricky0123/vad-web/dist/*.onnx",
            to: "static/chunks/[name][ext]",
          },
        ],
      }),
    );

    config.plugins.push(
      new webpack.DefinePlugin({
        "process.env.NEXT_PUBLIC_CONFIG_BUILD_ID": JSON.stringify(buildId),
      }),
    );

    return config;
  },
};

module.exports = withPWA(nextConfig);

// Injected content via Sentry wizard below

const { withSentryConfig } = require("@sentry/nextjs");

module.exports = withSentryConfig(module.exports, {
  // For all available options, see:
  // https://github.com/getsentry/sentry-webpack-plugin#options

  org: "heyamica",
  project: "chat-heyamica",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Automatically annotate React components to show their full name in breadcrumbs and session replay
  reactComponentAnnotation: {
    enabled: true,
  },

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  // Hides source maps from generated client bundles
  hideSourceMaps: true,

  // Automatically tree-shake Sentry logger statements to reduce bundle size
  disableLogger: true,

  // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
  // See the following for more information:
  // https://docs.sentry.io/product/crons/
  // https://vercel.com/docs/cron-jobs
  automaticVercelMonitors: true,
});
