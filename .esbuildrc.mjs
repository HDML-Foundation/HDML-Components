import fs from "fs";
import path from "path";
import * as esbuild from "esbuild"
import findCacheDir from "find-cache-dir";
import * as watch from "node-watch";
import { argv } from "process";

function buildWorkerPlugin() {
  async function buildWorker(workerPath) {
    const cacheDir = findCacheDir({
      name: "esbuild-worker",
      create: true,
    });
    const bundle = path.resolve(cacheDir, "worker.js");
    await esbuild.build({
      entryPoints: [workerPath],
      outfile: bundle,
      bundle: true,
      minify: true,
      sourcemap: true,
      format: "iife",
    });
    return fs.promises.readFile(bundle, {encoding: "utf-8"});
  }

  return {
    name: "esbuild-worker",
    setup(build) {
      // A2: match the `endpoint.js` seam (not `*.worker.js`) and
      // replace the whole module with a `Worker`-spawning form, so the
      // onmessage/@hdml/parser graph stays off the main bundle and
      // lives only inside the bundled worker string.
      build.onLoad(
        {
          filter: /endpoint\.js$/,
        },
        async ({ path: endpointPath }) => {
          const workerPath = path.resolve(
            path.dirname(endpointPath),
            "HdmlIo.worker.js",
          );
          let workerCode = await buildWorker(workerPath);
          return {
            contents:
              `const _script = ${JSON.stringify(workerCode)};\n` +
              `export function createEndpoint() {\n` +
              `  const blob = new Blob([_script], ` +
              `{ type: "text/javascript" });\n` +
              `  const url = URL.createObjectURL(blob);\n` +
              `  const w = new Worker(url);\n` +
              `  URL.revokeObjectURL(url);\n` +
              `  return w;\n` +
              `}\n` +
              `export function closeEndpoint(ep) {\n` +
              `  ep.terminate();\n` +
              `}\n`,
            loader: "js",
          };
        }
      );
    },
  };
}

async function build() {
  await esbuild.build({
    entryPoints: ["./esm/index.js"],
    outfile: "./bin/index.min.js",
    bundle: true,
    minify: true,
    sourcemap: true,
    format: "iife",
    plugins: [buildWorkerPlugin()],
  });
  console.log(
    `[${new Date().getHours()}:` +
    `${new Date().getMinutes()}:` +
    `${new Date().getSeconds()}] Bundle created.`,
  );
}

await build();

if(argv[2] === "--watch") {
  watch.default(path.resolve("./esm"), { recursive: true }, build);
}
