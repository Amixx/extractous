// Records what Tika loads by name while it extracts a set of documents, and
// merges it into the metadata of every OS:
// `bun trace-metadata.ts [--tika-config <file>]... <documents dir>...`, with
// GRAALVM_HOME set.
//
// native-image keeps only the classes, methods and resources it can see being
// used, so everything Tika loads by name (its parsers, the JDK's XML parser
// factories, resource files) has to be listed in the metadata. This extracts
// every document under the given dirs on a JVM under GraalVM's tracing agent,
// through the same entry point and parser configs the extractous crate uses
// (RecordTikaMetadata.java), once with Tika's default config and once with
// each given Tika config file. The merge only adds entries, so what earlier
// traces recorded stays.

import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fail, graalvmHome, mergeIntoEveryOs, run, tikaNative } from "./metadata";

const DOCUMENT_EXTENSIONS = /\.(pdf|docx?|pptx?|xlsx?|od[tps]|rtf|html?|xml|eml|jpe?g|png)$/i;
const USAGE = "usage: bun trace-metadata.ts [--tika-config <file>]... <documents dir>...";

const { values, positionals } = parseArgs({
	options: { "tika-config": { type: "string", multiple: true } },
	allowPositionals: true,
});
if (positionals.length === 0) fail(USAGE);
const tikaConfigs = (values["tika-config"] ?? []).map((file) => resolve(file));
for (const file of tikaConfigs) if (!existsSync(file)) fail(`Tika config ${file} does not exist`);
for (const dir of positionals) if (!existsSync(dir) || !statSync(dir).isDirectory()) fail(`${dir} is not a directory`);

const inputs = positionals.flatMap((dir) =>
	readdirSync(dir, { recursive: true, encoding: "utf8" })
		.map((entry) => resolve(dir, entry))
		.filter((file) => DOCUMENT_EXTENSIONS.test(file) && statSync(file).isFile())
		.sort(),
);
if (inputs.length === 0) fail(`no documents under ${positionals.join(", ")}`);
const graalvm = graalvmHome();

const work = mkdtempSync(join(tmpdir(), "trace-metadata-"));
try {
	// Gradle writes into the project dir, so it builds a copy.
	const project = join(work, "tika-native");
	cpSync(tikaNative, project, { recursive: true });
	writeFileSync(
		join(work, "classpath.gradle"),
		"allprojects { tasks.register('printRuntimeClasspath') { doLast { println 'CLASSPATH=' + project.sourceSets.main.runtimeClasspath.asPath } } }\n",
	);
	const env = { ...process.env, JAVA_HOME: graalvm };
	const gradleOutput = run(
		["./gradlew", "--no-daemon", "-q", "-I", join(work, "classpath.gradle"), "compileJava", "printRuntimeClasspath"],
		env,
		project,
	);
	const classpath = gradleOutput.match(/^CLASSPATH=(.*)$/m)?.[1] ?? fail("Gradle printed no runtime classpath");

	const driverClasses = join(work, "driver");
	run([
		join(graalvm, "bin", "javac"),
		"-d",
		driverClasses,
		"-cp",
		classpath,
		join(import.meta.dir, "RecordTikaMetadata.java"),
	]);

	const recorded = join(work, "recorded");
	for (const tikaConfig of [undefined, ...tikaConfigs]) {
		const traceEnv: Record<string, string | undefined> = { ...env };
		delete traceEnv.TIKA_CONFIG;
		if (tikaConfig) traceEnv.TIKA_CONFIG = tikaConfig;
		const output = run(
			[
				join(graalvm, "bin", "java"),
				`-agentlib:native-image-agent=config-merge-dir=${recorded}`,
				"-Djava.awt.headless=true",
				"-Duser.language=en",
				"-Duser.country=US",
				"-cp",
				`${driverClasses}:${classpath}`,
				"RecordTikaMetadata",
				...inputs,
			],
			traceEnv,
		);
		for (const line of output.trim().split("\n")) if (!line.startsWith("ok ")) console.log(line);
	}

	// A config file is read from its path on the tracing machine, which
	// means nothing inside the library.
	const recordedFile = join(recorded, "reachability-metadata.json");
	const metadata = JSON.parse(readFileSync(recordedFile, "utf8"));
	metadata.resources = (metadata.resources ?? []).filter((entry: { glob?: string }) => !entry.glob?.startsWith("/"));
	writeFileSync(recordedFile, `${JSON.stringify(metadata, null, 2)}\n`);

	mergeIntoEveryOs(graalvm, recorded);
	console.log(`• traced ${inputs.length} documents`);
} finally {
	rmSync(work, { recursive: true, force: true });
}
