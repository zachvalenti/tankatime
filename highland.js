'use strict';

/* Highland's file, opened.
 *
 * A .highland is not a screenplay: it is a zip archive with one inside,
 * in the TextBundle layout — a folder holding `text.md` (the Fountain
 * the writer typed) beside a heap of JSON the app keeps for itself.
 * Character counts, sidebar widths, cursor position, an entire base64
 * blob of the last revision. Open one in a text editor and the script is
 * in there, wedged between a PK header and a thousand curly braces.
 *
 * So this file does two things, in the order the import needs them:
 * reads the one entry that matters out of the archive, and turns
 * Highland's own additions to Fountain into Fountain. Nothing else is
 * kept. The settings belong to Highland and mean nothing here.
 *
 * Bytes in, text out. No DOM, like every file but app.js — the one
 * unusual thing it asks of a browser is DecompressionStream, and only
 * for archives that are actually compressed, which Highland's are not.
 */

// zip's four signatures, little-endian
const ZIP_LOCAL   = 0x04034b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_END     = 0x06054b50;

const u16 = (b, i) => b[i] | (b[i + 1] << 8);
const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

// → true if these bytes open like a zip, which is the only thing a
// .highland has in common with one from the outside
function hlIsBundle(bytes) {
  return bytes.length > 4 && u32(bytes, 0) === ZIP_LOCAL;
}

/* A zip is read from its end. The last record in the file — the "end of
 * central directory" — says where the catalogue of entries starts, and
 * the catalogue says where each entry's bytes are. There is no index at
 * the front, which is why a zip can be appended to.
 *
 * The signature is hunted backwards because the record ends in a comment
 * of any length up to 64k. Nothing else in the format lets you find it.
 */
function endRecord(b) {
  const stop = Math.max(0, b.length - 0xffff - 22);
  for (let i = b.length - 22; i >= stop; i--) if (u32(b, i) === ZIP_END) return i;
  return -1;
}

// the catalogue, as { name, method, size, at } — size being the
// compressed size, and `at` where the entry's own header sits
function entries(b) {
  const end = endRecord(b);
  if (end < 0) return [];
  const out = [];
  let n = u16(b, end + 10);
  let p = u32(b, end + 16);
  while (n-- > 0 && p + 46 <= b.length && u32(b, p) === ZIP_CENTRAL) {
    const name = u16(b, p + 28), extra = u16(b, p + 30), comment = u16(b, p + 32);
    out.push({
      name: new TextDecoder().decode(b.subarray(p + 46, p + 46 + name)),
      method: u16(b, p + 10),
      size: u32(b, p + 20),
      at: u32(b, p + 42),
    });
    p += 46 + name + extra + comment;
  }
  return out;
}

/* One entry's bytes.
 *
 * The entry's own header repeats the name and carries an extra field
 * that is often a different length from the catalogue's, so the data
 * cannot be found without reading it — the offset in the catalogue
 * points at the header, not at the bytes.
 *
 * Stored (0) and deflated (8) are the only methods worth answering.
 * Highland stores, so the common path never inflates anything; deflate
 * is here because a zip is a zip and somebody's will.
 */
async function readEntry(b, e) {
  const p = e.at;
  if (p + 30 > b.length || u32(b, p) !== ZIP_LOCAL) return null;
  const at = p + 30 + u16(b, p + 26) + u16(b, p + 28);
  const raw = b.subarray(at, at + e.size);
  if (e.method === 0) return raw;
  if (e.method !== 8 || typeof DecompressionStream !== 'function') return null;
  try {
    const stream = new Blob([raw]).stream()
      .pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (_) {
    return null;
  }
}

/* The script out of the bundle, or null if these bytes hold no script.
 *
 * TextBundle names the writing `text` with an extension for whatever it
 * is; Highland writes `text.md` even though what is in it is Fountain.
 * Everything else in the archive is the app's business — including
 * `scratchpad.txt`, which is a real file with a writer's real notes in
 * it and still not the script this import is for.
 *
 * Returning null rather than throwing: a caller handed a .zip of photos
 * has asked a reasonable question and deserves an answer, not an
 * exception.
 */
const BUNDLE_TEXT = /(^|\/)text\.(md|markdown|txt|fountain)$/i;

async function hlUnbundle(bytes) {
  const hit = entries(bytes).filter(e => BUNDLE_TEXT.test(e.name))
    // the shallowest one, so a bundle nested inside another can't win
    .sort((a, b) => a.name.split('/').length - b.name.split('/').length)[0];
  if (!hit) return null;
  const raw = await readEntry(bytes, hit);
  return raw ? new TextDecoder().decode(raw) : null;
}

/* Highland's Fountain, as Fountain.
 *
 * Almost all of what is in that text.md is the real format: the title
 * page, the sluglines, the cues, `=` synopses and `#` sections are all
 * Fountain and all already understood here. The one addition is a note
 * block fenced by `%%` on its own line — research, a link, a paragraph
 * the writer wants beside the script rather than in it — and no other
 * program that reads Fountain knows what those two characters mean.
 *
 * They become the boneyard — the slash-star fences Fountain already has
 * for this, which say the same thing in a way every renderer reads:
 * kept in the file, struck from the script, out of the page count.
 * Deleting them would be the shorter code and the wrong answer — those
 * are the writer's words, and an import that quietly eats a page of
 * research is an import nobody trusts twice.
 *
 * A fence left open at the end of the file gets closed here rather than
 * left to swallow whatever follows it. Fountain's boneyard runs to the
 * end of the document when it is never closed, and an unbalanced `%%`
 * means the writer lost a fence, not that they meant the rest to go.
 */
function hlFountain(text) {
  let open = false;
  const out = text.split('\n').map(line => {
    if (line.trim() !== '%%') return line;
    open = !open;
    return open ? '/*' : '*/';
  });
  if (open) out.push('*/');
  return out.join('\n');
}

// Node (a test run, or a future build tool) sees module; the browser
// doesn't and skips this
if (typeof module !== 'undefined') {
  module.exports = { hlIsBundle, hlUnbundle, hlFountain };
}
