// Bundle the extension into a single file. By including all dependencies like prismjs,
// there is no need to bundle node_modules into the vsix. Only VS Code itself remains external.
const esbuild = require("esbuild");

// Generate the static import list of all Prism languages (src/prism-languages.generated.ts).
require("./scripts/gen-prism-imports.cjs");

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

/** @type {import('esbuild').BuildOptions} */
const extensionOptions = {
    entryPoints: ["src/extension.ts"],
    bundle: true,
    platform: "node",
    target: "node18", // VS Code 1.85 uses Node 18
    format: "cjs",
    outfile: "dist/extension.js",
    external: ["vscode"], // Provided by VS Code at runtime
    minify: production,
    sourcemap: !production,
    logLevel: "info",
};

/** @type {import('esbuild').BuildOptions} */
const coreOptions = {
    entryPoints: ["src/core.ts"],
    bundle: true,
    platform: "node",
    target: "node18",
    format: "cjs",
    outfile: "dist/core.js",
    sourcemap: !production,
    logLevel: "info",
};

async function main() {
    if (watch) {
        const extensionCtx = await esbuild.context(extensionOptions);
        const coreCtx = await esbuild.context(coreOptions);
        await Promise.all([extensionCtx.watch(), coreCtx.watch()]);
        console.log("esbuild: watching...");
    } else {
        await Promise.all([
            esbuild.build(extensionOptions),
            esbuild.build(coreOptions),
        ]);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
