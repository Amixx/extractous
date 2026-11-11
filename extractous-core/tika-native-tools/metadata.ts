// The GraalVM reachability metadata libtika_native is built with:
// tika-native/src/main/resources/META-INF/ai.yobix/tika-<version>-<os>/, one
// dir per OS, which build.gradle hands to native-image.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

export const tikaNative = join(import.meta.dir, "..", "tika-native");

export function fail(message: string): never {
	console.error(`error: ${message}`);
	process.exit(1);
}

export function graalvmHome(): string {
	const home = process.env.GRAALVM_HOME || fail("GRAALVM_HOME is not set");
	if (!existsSync(join(home, "bin", "native-image-configure"))) fail(`${home} holds no bin/native-image-configure`);
	return home;
}

export function run(cmd: string[], env: Record<string, string | undefined> = process.env, cwd?: string): string {
	console.log(`• ${cmd.slice(0, 3).join(" ")}${cmd.length > 3 ? " …" : ""}`);
	const result = Bun.spawnSync(cmd, { cwd, env, stdout: "pipe", stderr: "inherit" });
	if (result.exitCode !== 0) fail(`${cmd[0]} exited with ${result.exitCode}`);
	return result.stdout.toString();
}

/** The metadata dir of each OS for the Tika version in build.gradle. */
export function osDirs(): string[] {
	const tikaVersion =
		readFileSync(join(tikaNative, "build.gradle"), "utf8").match(/def tikaVersion = "([^"]+)"/)?.[1] ??
		fail("no tikaVersion in tika-native/build.gradle");
	const root = join(tikaNative, "src", "main", "resources", "META-INF", "ai.yobix");
	const dirs = ["linux", "macos", "windows"].map((os) => join(root, `tika-${tikaVersion}-${os}`));
	for (const dir of dirs) {
		if (!existsSync(join(dir, "reachability-metadata.json"))) fail(`${dir} holds no reachability-metadata.json`);
	}
	return dirs;
}

function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (value === null || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
	);
}

/**
 * Merges the reachability metadata in `added` into every OS's metadata with
 * native-image-configure, which only adds entries.
 */
export function mergeIntoEveryOs(graalvm: string, added: string) {
	const work = mkdtempSync(join(tmpdir(), "tika-native-merge-"));
	try {
		for (const dir of osDirs()) {
			const merged = join(work, basename(dir));
			mkdirSync(merged);
			run([
				join(graalvm, "bin", "native-image-configure"),
				"generate",
				`--input-dir=${dir}`,
				`--input-dir=${added}`,
				`--output-dir=${merged}`,
			]);
			// Key order and indent as Extractous writes the file, so a diff shows only what changed.
			const metadata = JSON.parse(readFileSync(join(merged, "reachability-metadata.json"), "utf8"));
			writeFileSync(join(dir, "reachability-metadata.json"), JSON.stringify(sortKeys(metadata), null, 4));
			console.log(`• merged into ${dir}`);
		}
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}
