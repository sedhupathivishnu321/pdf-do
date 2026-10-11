/* PDF Do — password protection: PDF 2.0 standard security handler, AES-256 (V5 / R6), built on WebCrypto */
(function () {
  'use strict';
  const PD = window.PD;
  const L = window.PDFLib;
  const subtle = crypto.subtle;
  const enc = new TextEncoder();

  const concat = (...parts) => { let n = 0; parts.forEach((p) => (n += p.length)); const o = new Uint8Array(n); let k = 0; parts.forEach((p) => { o.set(p, k); k += p.length; }); return o; };
  const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
  const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
  const sha = async (alg, data) => new Uint8Array(await subtle.digest(alg, data));

  // AES-CBC without padding (input must be block aligned): encrypt with PKCS#7 and drop the extra block
  async function cbcNoPad(keyBytes, iv, data) {
    const k = await subtle.importKey('raw', keyBytes, 'AES-CBC', false, ['encrypt']);
    const out = new Uint8Array(await subtle.encrypt({ name: 'AES-CBC', iv }, k, data));
    return out.slice(0, data.length);
  }
  // ISO 32000-2 algorithm 2.B (hash for revision 6)
  async function hash2B(pw, salt, udata) {
    let k = await sha('SHA-256', concat(pw, salt, udata));
    let e = new Uint8Array(1); let i = 0;
    while (i < 64 || e[e.length - 1] > i - 32) {
      const unit = concat(pw, k, udata); const k1 = new Uint8Array(unit.length * 64);
      for (let r = 0; r < 64; r++) k1.set(unit, r * unit.length);
      e = await cbcNoPad(k.slice(0, 16), k.slice(16, 32), k1);
      let sum = 0; for (let j = 0; j < 16; j++) sum += e[j];
      const m = sum % 3; k = await sha(m === 0 ? 'SHA-256' : m === 1 ? 'SHA-384' : 'SHA-512', e);
      i++;
    }
    return k.slice(0, 32);
  }
  const pwBytes = (s) => enc.encode(String(s || '').normalize('NFC')).slice(0, 127);

  async function encryptBlob(fileKey, data) {
    const iv = rand(16); const k = await subtle.importKey('raw', fileKey, 'AES-CBC', false, ['encrypt']);
    const body = new Uint8Array(await subtle.encrypt({ name: 'AES-CBC', iv }, k, data));
    return concat(iv, body);
  }

  /* perms: {print, modify, copy, annotate, fill, access, assemble, hiprint} booleans */
  PD.pdf.encrypt = async function (bytes, userPw, ownerPw, perms) {
    perms = perms || {};
    const pdf = await PD.pdf.load(bytes);
    const ctx = pdf.context;
    const fileKey = rand(32);
    let P = 0xfffff0c0;
    const bit = (n, on) => { if (on) P |= n; else P &= ~n; };
    bit(4, perms.print !== false); bit(8, perms.modify !== false); bit(16, perms.copy !== false); bit(32, perms.annotate !== false);
    bit(256, perms.fill !== false); bit(512, true); bit(1024, perms.assemble !== false); bit(2048, perms.hiprint !== false);
    const Pint = P | 0;

    const up = pwBytes(userPw), op = pwBytes(ownerPw || hex(rand(12)));
    const empty = new Uint8Array(0), zero = new Uint8Array(16);
    const uvs = rand(8), uks = rand(8), ovs = rand(8), oks = rand(8);
    const U = concat(await hash2B(up, uvs, empty), uvs, uks);
    const UE = await cbcNoPad(await hash2B(up, uks, empty), zero, fileKey);
    const O = concat(await hash2B(op, ovs, U), ovs, oks);
    const OE = await cbcNoPad(await hash2B(op, oks, U), zero, fileKey);
    const permBlock = new Uint8Array(16); const dv = new DataView(permBlock.buffer);
    dv.setInt32(0, Pint, true); dv.setUint32(4, 0xffffffff, true); permBlock[8] = 0x54; permBlock[9] = 0x61; permBlock[10] = 0x64; permBlock[11] = 0x62; permBlock.set(rand(4), 12);
    const Perms = await cbcNoPad(fileKey, zero, permBlock);

    // encrypt every string and stream in the document
    const encStr = async (v) => {
      if (v instanceof L.PDFString || v instanceof L.PDFHexString) return L.PDFHexString.of(hex(await encryptBlob(fileKey, v.asBytes())));
      return null;
    };
    const walk = async (obj) => {
      if (obj instanceof L.PDFDict) {
        for (const [k, v] of obj.entries()) { const r = await encStr(v); if (r) obj.set(k, r); else if (v instanceof L.PDFDict || v instanceof L.PDFArray) await walk(v); }
      } else if (obj instanceof L.PDFArray) {
        for (let i = 0; i < obj.size(); i++) { const v = obj.get(i); const r = await encStr(v); if (r) obj.set(i, r); else if (v instanceof L.PDFDict || v instanceof L.PDFArray) await walk(v); }
      }
    };
    const entries = ctx.enumerateIndirectObjects().slice();
    for (const [ref, obj] of entries) {
      if (obj instanceof L.PDFStream) {
        const t = obj.dict.get(L.PDFName.of('Type'));
        if (t && (t.toString() === '/XRef' || t.toString() === '/ObjStm')) continue;
        await walk(obj.dict);
        obj.updateDict();
        const contents = obj.getContents();
        const raw = L.PDFRawStream.of(obj.dict, await encryptBlob(fileKey, contents));
        ctx.assign(ref, raw);
      } else if (obj instanceof L.PDFDict || obj instanceof L.PDFArray) await walk(obj);
      else { /* numbers, names, direct strings at top level are not used by PDF writers */ }
    }

    const encDict = ctx.obj({
      Filter: 'Standard', V: 5, R: 6, Length: 256,
      CF: { StdCF: { AuthEvent: 'DocOpen', CFM: 'AESV3', Length: 32 } }, StmF: 'StdCF', StrF: 'StdCF',
      O: L.PDFHexString.of(hex(O)), U: L.PDFHexString.of(hex(U)), OE: L.PDFHexString.of(hex(OE)), UE: L.PDFHexString.of(hex(UE)),
      P: Pint, Perms: L.PDFHexString.of(hex(Perms)), EncryptMetadata: true,
    });
    const encRef = ctx.register(encDict);
    ctx.trailerInfo.Encrypt = encRef;
    ctx.trailerInfo.ID = ctx.obj([L.PDFHexString.of(hex(rand(16))), L.PDFHexString.of(hex(rand(16)))]);
    return await pdf.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
  };
})();
