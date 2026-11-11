# Extractous 0.3.0 on Apache Tika 3.3.3

This fork's `tika-3` branch is Extractous v0.3.0 with its native library
built from Apache Tika 3.3.3 instead of 2.9.2. Tika 2.9.2 is affected by
CVE-2025-66516 (XXE through an XFA form in a PDF), fixed in Tika 3.2.2.
The Rust API is unchanged, and the toolchain stays on GraalVM 23.

What differs from v0.3.0, all under `extractous-core/`:

- `tika-native/build.gradle`: `tikaVersion` is 3.3.3; the
  `tika-parser-html-commons` dependency is gone (Tika 3 has no such
  module); native-image runs with
  `-Dangus.activation.native-image.enable=false`, without which the build
  fails on Eclipse Angus Activation, which Tika 3 pulls in.
- `tika-native/src/main/java/ai/yobix/ParsingReader.java`: Tika 3 has no
  `BodyContentHandler(OutputStream)`, so the handler gets a `Writer` in
  the default charset, which that constructor used.
- `tika-native/src/main/resources/META-INF/ai.yobix/tika-3.3.3-{linux,macos,windows}/`:
  v0.3.0's `tika-2.9.2-*` reachability metadata, renamed because
  `build.gradle` reads `tika-<version>-<os>`, with the entries Tika 3
  needs added from a trace of Tika 3.3.3 on a JVM over a set of PDF,
  Office, OpenDocument, RTF, HTML, XML, e-mail and image documents. Tika 3
  renamed several classes loaded by name, such as the HTML parser and the
  XML parser factories; without these entries the build succeeds and
  those formats fail at run time. All v0.3.0 entries are kept. The
  metadata also registers every compiled OOXML schema (`.xsb`) and every
  XMLBeans `…Impl` class in `poi-ooxml-full`, so POI can read DOCX,
  XLSX and PPTX parts no trace met, such as a DOCX comments part, and
  `DefaultParser`'s public constructors, without which the library
  ignores the `<parser>` elements of a Tika config file.
- `tika-native-tools/`: the scripts that write that metadata (see
  below).
- `build.rs`: `OUT_DIR/libs` comes only from that OUT_DIR's own Gradle
  build. v0.3.0 copies in the libs of the first
  `target/<profile>/build/extractous-*` dir it finds, which can be another
  build's, such as a Tika 2.9.2 one from the crates.io release.
- `build.rs`: the build script fails when Gradle does, and a rerun skips
  Gradle only when its OUT_DIR holds the stamp written after a successful
  build. Gradle creates `nativeCompile/` before native-image runs, so an
  interrupted build runs Gradle again instead of copying from an empty
  dir.
- `build.rs`: the built libraries go only to `OUT_DIR`. v0.3.0 also
  copies them into `bindings/extractous-python/`, outside `OUT_DIR`,
  which a Cargo git checkout contains too; two builds sharing that
  checkout race on the copy. The Python bindings are not built from
  this branch.

Use it as a Cargo git dependency pinned to a commit:

```toml
extractous = { git = "https://github.com/Amixx/extractous", rev = "<commit>" }
```

Only macOS (arm64) was built and tested end to end; the Linux and Windows
metadata got the same additions.

## Updating the metadata

The scripts in `extractous-core/tika-native-tools/` run with
[Bun](https://bun.sh) and need `GRAALVM_HOME` set to a GraalVM 23. Both
merge into the metadata of all three OSes and only add entries. They
live outside `tika-native/`, the directory the build script copies and
builds, so they are no input of the library. Commands below run from
`extractous-core/`.

For a Tika or POI version bump, or a document that fails only in the
native library:

1. Change what needs changing. For a Tika release: `tikaVersion` in
   `tika-native/build.gradle` and the names of the three
   `tika-<version>-<os>` metadata dirs.
2. Trace Tika on a JVM over a document set, once with Tika's default
   config and once with each `--tika-config` given:
   `bun tika-native-tools/trace-metadata.ts [--tika-config <file>]... <documents dir>...`
3. Regenerate the POI entries from the `poi-ooxml-full` jar Tika
   depends on (Gradle keeps it under
   `~/.gradle/caches/modules-2/files-2.1/org.apache.poi/poi-ooxml-full/`):
   `bun tika-native-tools/ooxml-metadata.ts <poi-ooxml-full.jar>`
4. Build, test, update this file, and push to `tika-3`.
5. Consumers set `rev` to the new commit.
