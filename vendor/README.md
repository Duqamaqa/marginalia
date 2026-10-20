# PDF export dependencies

These browser dependencies are local and are loaded only when creating a PDF. No vocabulary is sent to an external PDF service.

- pdf-lib 1.17.1: pdf-lib.esm.min.js, MIT. Source: https://www.npmjs.com/package/pdf-lib/v/1.17.1
- @pdf-lib/fontkit 1.1.1: fontkit.es.min.js, MIT. Source: https://www.npmjs.com/package/@pdf-lib/fontkit/v/1.1.1 . The fully bundled UMD build is wrapped as an ES module; its bundled pako dependency requires no network import.
- Noto Sans Regular: NotoSans-Regular.ttf, SIL Open Font License 1.1. Source: https://github.com/notofonts/noto-fonts/blob/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf

License notices accompany the bundles. The font is embedded into generated PDFs so Cyrillic text stays readable and extractable.
