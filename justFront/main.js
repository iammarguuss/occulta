// main.js — ULDA playground v1.1 (hex / base64 / bytes export)
// Updated: 2025-07-05
// • Export подписи: префикс «len N hash mode idx» + bytes сигнатуры
// • Универсальный enc.hash(name) → WebCrypto
// • ULDA‑X переработан по матрице: треугольник {F^d_i}, финал lastRow[0]
// • enc.ladder возвращает sigBlocks (Uint8Array[]) и final
// • Sign() теперь выдаёт standalone‑package (header+sig) без origin‑блоков
// • Packer.simpleSig: concat header+sig
//

class UldaSign {
  /** @param {Object=} cfg */
  constructor(cfg = {}) {
    /* ---------- глобальный конфиг ---------- */
    this.globalConfig = {
      version: cfg.version ?? '1',
      fmt: {
        input:  cfg?.fmt?.input  ?? 'hex',
        export: cfg?.fmt?.export ?? 'hex'
      },
      sign: {
        N:          cfg?.sign?.N          ?? 5,
        mode:       cfg?.sign?.mode       ?? 'S',
        hash:       cfg?.sign?.hash       ?? 'SHA-256',
        originSize: cfg?.sign?.originSize ?? 256,
        pack:       cfg?.sign?.pack       ?? 'simpleSig'
      }
    };

    /* ---------- словари кодов ---------- */
    this.encoder = {
      mode:      { S: 0x01, X: 0x02 },
      algorithm: { 'SHA-256': 0x01 }
    };
    this.decoder = {
      mode:      { 0x01: 'S', 0x02: 'X' },
      algorithm: { 0x01: 'SHA-256' }
    };

    /* ---------- convert helpers ---------- */
    this.convert = {
      bytesToHex: u8 => Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join(''),
      hexToBytes: str => Uint8Array.from(str.match(/../g).map(h => parseInt(h, 16))),
      bytesToBase64: u8 => btoa(String.fromCharCode(...u8)),
      base64ToBytes: str => Uint8Array.from(atob(str), c => c.charCodeAt(0)),
      guessToBytes: str => (/^[0-9a-f]+$/i.test(str) && str.length % 2 === 0)
        ? this.convert.hexToBytes(str)
        : this.convert.base64ToBytes(str),
      indexToBytes: idx => {
        const big = typeof idx === 'bigint' ? idx : BigInt(idx);
        if (big === 0n) return Uint8Array.of(0);
        const arr = [];
        let tmp = big;
        while (tmp > 0n) { arr.unshift(Number(tmp & 0xffn)); tmp >>= 8n; }
        return Uint8Array.from(arr);
      },
      concatBytes: (...arrays) => {
        const total = arrays.reduce((s, a) => s + a.length, 0);
        const out = new Uint8Array(total);
        let off = 0;
        arrays.forEach(a => { out.set(a, off); off += a.length; });
        return out;
      }
    };

    /* ---------- cryptographic helpers ---------- */
    const self = this;
    this.enc = {
      /* generic hash(selector) */
      hash: async (u8, alg = 'SHA-256') => {
        switch (alg) {
          case 'SHA-256':
          default:
            return new Uint8Array(await crypto.subtle.digest('SHA-256', u8));
        }
      },

      /* main ladder dispatcher */
      ladder: async (blocks, mode = 'S', alg = 'SHA-256') => {
        switch (mode) {
          case 'X':  return self.enc._ladderX(blocks, alg);
          case 'S':
          default:   return self.enc._ladderS(blocks, alg);
        }
      },

      /* ULDA‑S: t0, f(t1), f(f(t2)) … */
      _ladderS: async (blocks, alg) => {
        const sigBlocks = [];
        for (let i = 0; i < blocks.length; i++) {
          let h = blocks[i];
          for (let r = 0; r < i; r++) h = await self.enc.hash(h, alg);
          sigBlocks.push(h);
        }
        return { sigBlocks, final: sigBlocks.at(-1) };
      },

      /* ULDA‑X: треугольная матрица */
      _ladderX: async (blocks, alg) => {
        const rows = []; // rows[d][i]
        rows.push(blocks.slice()); // row 0 = raw
        const cat = self.convert.concatBytes;
        for (let d = 1; d < blocks.length; d++) {
          const prevRow = rows[d - 1];
          const curRow  = [];
          for (let i = 0; i < prevRow.length - 1; i++) {
            const concatenated = cat(prevRow[i], prevRow[i + 1]);
            curRow.push(await self.enc.hash(concatenated, alg));
          }
          rows.push(curRow);
        }
        // flatten rows to sigBlocks row‑wise
        const sigBlocks = rows.flat();
        const final = rows.at(-1)[0];
        return { sigBlocks, final };
      }
    };

    /* ---------- actions ---------- */
    this.actions = {
      /* generators */
      OriginGenerator: () => {
        const { N, originSize } = self.globalConfig.sign;
        const byteLen = originSize >>> 3;
        return { origin: Array.from({ length: N }, () => this.actions.RandomBlock(byteLen)) };
      },
      RandomBlock: len => { const u = new Uint8Array(len); crypto.getRandomValues(u); return u; },

      /* ===== Export helpers ===== */
      _buildHeader: (N, mode, alg, idxBytes) => {
        const headerLen = 5 + idxBytes.length + 1;
        const h = new Uint8Array(headerLen);
        h[0] = 0x00;
        h[1] = headerLen & 0xff;
        h[2] = N & 0xff;
        h[3] = self.encoder.mode[mode] ?? 0xff;
        h[4] = self.encoder.algorithm[alg] ?? 0xff;
        h.set(idxBytes, 5);
        h[headerLen - 1] = 0x00;
        return h;
      },

      NewExporter: (originObj, index = 0n) => {
        const { N, mode, hash } = self.globalConfig.sign;
        const idxBytes = self.convert.indexToBytes(index);
        const header   = this.actions._buildHeader(N, mode, hash, idxBytes);
        const blocks   = originObj.origin;
        const out      = self.convert.concatBytes(header, ...blocks);
        return self._export(out);
      },

      SignExporter: (sigBytes, index, N, mode, hash) => {
        const idxBytes = self.convert.indexToBytes(index);
        const header   = this.actions._buildHeader(N, mode, hash, idxBytes);
        const out      = self.convert.concatBytes(header, sigBytes);
        return self._export(out);
      },

      Importer: pkg => {
        const bytes = pkg instanceof Uint8Array ? pkg
                     : typeof pkg === 'string'  ? self._importToBytes(pkg)
                                                : (() => { throw new TypeError('bad pkg'); })();
        const headerLen = bytes[1];
        if (bytes[0] !== 0x00 || bytes[headerLen - 1] !== 0x00) throw new Error('sentinel');
        const N    = bytes[2];
        const mode = self.decoder.mode[bytes[3]] ?? 'U';
        const alg  = self.decoder.algorithm[bytes[4]] ?? 'UNK';
        let idx = 0n; for (let i = 5; i < headerLen - 1; i++) idx = (idx << 8n) | BigInt(bytes[i]);
        const body = bytes.slice(headerLen);
        const blockLen = body.length / N;
        if (!Number.isInteger(blockLen)) throw new Error('div');
        const origin = [];
        for (let i = 0; i < N; i++) origin.push(body.slice(i * blockLen, (i + 1) * blockLen));
        return { bytes, N, mode, alg, index: idx, blockLen, origin };
      },

      StepUp: pkg => {
        const p = this.actions.Importer(pkg);
        const { origin, blockLen, index } = p;
        const newBlocks = origin.slice(1);
        newBlocks.push(this.actions.RandomBlock(blockLen));
        return this.actions.NewExporter({ origin: newBlocks }, index + 1n);
      },

      Sign: async pkg => {
        const p = this.actions.Importer(pkg);
        const { origin, mode, alg, index, N } = p;
        const { sigBlocks } = await self.enc.ladder(origin, mode, alg);
        const sigBytes = self.convert.concatBytes(...sigBlocks);
        return this.actions.SignExporter(sigBytes, index, N, mode, alg);
      }
    };

    /* ---------- internal export/import helpers ---------- */
    this._export = bytes => {
      switch (this.globalConfig.fmt.export) {
        case 'base64': return this.convert.bytesToBase64(bytes);
        case 'bytes':  return bytes;
        case 'hex':
        default:       return this.convert.bytesToHex(bytes);
      }
    };
    this._importToBytes = str => {
      const fmt = this.globalConfig.fmt.export;
      return fmt === 'hex'    ? this.convert.hexToBytes(str)
           : fmt === 'base64' ? this.convert.base64ToBytes(str)
                                : this.convert.guessToBytes(str);
    };
  }

  /* ---------- PUBLIC API ---------- */
  async New(index = 0n) { return this.actions.NewExporter(this.actions.OriginGenerator(), index); }
  async stepUp(pkg)     { return this.actions.StepUp(pkg); }
  async sign(pkg)       { return this.actions.Sign(pkg); }
  async verify()        { console.log('verify TBD'); return true; }
}

window.UldaSign = UldaSign;
