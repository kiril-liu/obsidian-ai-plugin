import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const production = process.argv[2] === "production";

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtins,
	],
	format: "cjs",
	target: "es2020",
	logLevel: "info",
	sourcemap: production ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
	minify: production,
	banner: {
		js: `var import_meta_url;
try {
	import_meta_url = require('url').pathToFileURL(__filename).href;
} catch (e) {
	import_meta_url = typeof __filename !== "undefined" ? __filename : "";
}`,
	},
	define: {
		"import.meta.url": "import_meta_url",
	},
	// 关键：把 onnxruntime-node 重定向到 onnxruntime-web。
	// Obsidian(Electron 渲染进程)里没有 onnxruntime-node 需要的原生二进制，
	// transformers.js 又会因为 process.release.name === "node" 去选它 → InferenceSession 为 undefined → reading 'create'。
	// 重定向后它拿到的永远是 wasm 版的 web 运行时。
	alias: {
		"onnxruntime-node": "onnxruntime-web",
	},
});

if (production) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}