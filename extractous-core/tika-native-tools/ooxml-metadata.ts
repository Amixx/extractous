// Registers every OOXML type of Apache POI in the metadata of every OS:
// `bun ooxml-metadata.ts <poi-ooxml-full.jar>`, with GRAALVM_HOME set.
//
// POI reads OOXML parts through XMLBeans, which loads a compiled schema
// (`.xsb` resource) per type and instantiates the type's `…Impl` class by
// reflection. A trace lists only the types its documents met, and POI then
// fails on any other part, such as a DOCX comments part. So this registers
// every schema and `…Impl` class in the poi-ooxml-full jar Tika depends on.
// Gradle keeps that jar under
// ~/.gradle/caches/modules-2/files-2.1/org.apache.poi/poi-ooxml-full/.
//
// It also registers DefaultParser's public constructors, through which alone
// a Tika config file can leave parsers out; without them libtika_native
// ignores the file's `<parser>` elements.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fail, graalvmHome, mergeIntoEveryOs, run } from "./metadata";

const jar = process.argv[2] ?? fail("usage: bun ooxml-metadata.ts <poi-ooxml-full.jar>");
const graalvm = graalvmHome();

const entries = run([join(graalvm, "bin", "jar"), "tf", jar]).split("\n").filter((entry) => entry !== "");
const implClasses = entries
	.filter((entry) => /\/impl\/[^/$]+Impl\.class$/.test(entry))
	.map((entry) => entry.slice(0, -".class".length).replaceAll("/", "."));
if (implClasses.length === 0) fail(`no XMLBeans Impl classes in ${jar}`);
const schemas = "org/apache/poi/schemas/ooxml/**/*.xsb";
if (!entries.some((entry) => entry.startsWith("org/apache/poi/schemas/ooxml/") && entry.endsWith(".xsb"))) {
	fail(`no compiled schemas under org/apache/poi/schemas/ooxml/ in ${jar}`);
}

const added = mkdtempSync(join(tmpdir(), "ooxml-metadata-"));
try {
	const metadata = {
		reflection: [
			...implClasses.map((type) => ({ type, allDeclaredConstructors: true })),
			{ type: "org.apache.tika.parser.DefaultParser", allPublicConstructors: true },
		],
		resources: [{ glob: schemas }],
	};
	writeFileSync(join(added, "reachability-metadata.json"), JSON.stringify(metadata));
	mergeIntoEveryOs(graalvm, added);
	console.log(`• ${implClasses.length} Impl classes and ${schemas}`);
} finally {
	rmSync(added, { recursive: true, force: true });
}
