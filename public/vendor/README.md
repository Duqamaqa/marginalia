# PDF export dependencies

These browser dependencies are local and are loaded only when creating a PDF. No vocabulary is sent to an external PDF service.

- pdf-lib 1.17.1: pdf-lib.esm.min.js, MIT. Source: https://www.npmjs.com/package/pdf-lib/v/1.17.1
- @pdf-lib/fontkit 1.1.1: fontkit.es.min.js, MIT. Source: https://www.npmjs.com/package/@pdf-lib/fontkit/v/1.1.1 . The fully bundled UMD build is wrapped as an ES module; its bundled pako dependency requires no network import.
- Noto Sans Regular: NotoSans-Regular.ttf, SIL Open Font License 1.1. Source: https://github.com/notofonts/noto-fonts/blob/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf

License notices accompany the bundles. The font is embedded into generated PDFs so Cyrillic text stays readable and extractable.

- Noto Sans Hebrew Regular, version 3.000: NotoSansHebrew-Regular.ttf, SIL Open Font License 1.1. Official source: https://github.com/notofonts/noto-fonts/blob/main/hinted/ttf/NotoSansHebrew/NotoSansHebrew-Regular.ttf . Font metadata copyright: 2019 Google Inc. The original repository OFL is included as NotoSansHebrew-LICENSE.txt. Loaded only when PDF content contains Hebrew.
- bidi-js 1.0.3: bidi.es.min.js, MIT. Source: https://www.npmjs.com/package/bidi-js/v/1.0.3 ; bundled upstream distribution https://unpkg.com/bidi-js@1.0.3/dist/bidi.min.js wrapped as a local ES module. License: bidi-LICENSE.txt. Implements Unicode bidirectional ordering for mixed Hebrew, Russian, English and numbers.

Hebrew PDF lines contain logical Unicode ActualText spans and embedded Hebrew glyphs; visual bidi ordering is separate from content reading order. Both fonts remain local and no PDF text is sent to another service.
