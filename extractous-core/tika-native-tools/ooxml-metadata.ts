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
import { fail, graalvmHome, mergeIntoEveryOs } from "./metadata";

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;

/** Entry names of a zip archive, read from its central directory (no ZIP64). */
function zipEntries(zip: Uint8Array, name: string): string[] {
	const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
	// The end record is 22 bytes plus a comment of up to 65535 bytes.
	let end = zip.length - 22;
	while (end >= Math.max(0, zip.length - 22 - 0xffff) && view.getUint32(end, true) !== END_OF_CENTRAL_DIRECTORY) end--;
	if (end < 0 || view.getUint32(end, true) !== END_OF_CENTRAL_DIRECTORY) fail(`${name} is not a zip archive`);
	const count = view.getUint16(end + 10, true);
	let offset = view.getUint32(end + 16, true);
	if (count === 0xffff || offset === 0xffffffff) fail(`${name} is a ZIP64 archive`);

	const decoder = new TextDecoder();
	const names: string[] = [];
	for (let i = 0; i < count; i++) {
		if (view.getUint32(offset, true) !== CENTRAL_DIRECTORY_HEADER) fail(`${name} has a corrupt central directory`);
		const nameLength = view.getUint16(offset + 28, true);
		const extraLength = view.getUint16(offset + 30, true);
		const commentLength = view.getUint16(offset + 32, true);
		names.push(decoder.decode(zip.subarray(offset + 46, offset + 46 + nameLength)));
		offset += 46 + nameLength + extraLength + commentLength;
	}
	return names;
}

const jar = process.argv[2] ?? fail("usage: bun ooxml-metadata.ts <poi-ooxml-full.jar>");
const graalvm = graalvmHome();

const entries = zipEntries(await Bun.file(jar).bytes(), jar);
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
