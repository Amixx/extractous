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
  those formats fail at run time. All v0.3.0 entries are kept.
- `build.rs`: `OUT_DIR/libs` comes only from that OUT_DIR's own Gradle
  build. v0.3.0 copies in the libs of the first
  `target/<profile>/build/extractous-*` dir it finds, which can be another
  build's, such as a Tika 2.9.2 one from the crates.io release.
- `build.rs`: the build script fails when Gradle does, and a rerun skips
  Gradle only when its OUT_DIR holds the stamp written after a successful
  build. Gradle creates `nativeCompile/` before native-image runs, so an
  interrupted build runs Gradle again instead of copying from an empty
  dir.

Use it as a Cargo git dependency pinned to a commit:

```toml
extractous = { git = "https://github.com/Amixx/extractous", rev = "<commit>" }
```

Only macOS (arm64) was built and tested end to end; the Linux and Windows
metadata got the same additions.
