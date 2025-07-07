class UldaSign {
  constructor(cfg = {}) {
    /* ---------- глобальный конфиг ---------- */
    this.globalConfig = {
      version: cfg.version ?? '1',
      fmt: {

        export: cfg?.fmt?.export ?? 'hex'
      },
      sign: {
        N: cfg?.sign?.N ?? 5,
        mode: cfg?.sign?.mode ?? 'S',
        hash: cfg?.sign?.hash ?? 'SHA-256',
        originSize: cfg?.sign?.originSize ?? 256,
        pack: cfg?.sign?.pack ?? 'simpleSig'
      }
    };
    /* ---------- кодовые таблицы ---------- */
    this.encoder = { mode: { S: 0x01, X: 0x02}, algorithm: { 'SHA-256': 0x01 } };
    this.decoder = { mode: { 0x01: 'S', 0x02: 'X'}, algorithm: { 0x01: 'SHA-256' } };
    /* ---------- convert ---------- */
    this.convert = {
      bytesToHex: u8 => Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join(''),
      hexToBytes: str => Uint8Array.from(str.match(/../g).map(h => parseInt(h, 16))),
      bytesToBase64: u8 => btoa(String.fromCharCode(...u8)),
      base64ToBytes: str => Uint8Array.from(atob(str), c => c.charCodeAt(0)),
      guessToBytes: str => (/^[0-9a-f]+$/i.test(str) && str.length % 2 === 0)
        ? this.convert.hexToBytes(str)
        : this.convert.base64ToBytes(str),
      indexToBytes: idx => {
        const b = typeof idx === 'bigint' ? idx : BigInt(idx);
        if (b === 0n) return Uint8Array.of(0);
        const arr = []; let tmp = b;
        while (tmp > 0n) { arr.unshift(Number(tmp & 0xffn)); tmp >>= 8n; }
        return Uint8Array.from(arr);
      },
      concatBytes: (...arrs) => {
        const len = arrs.reduce((s, a) => s + a.length, 0);
        const out = new Uint8Array(len); let off = 0;
        arrs.forEach(a => { out.set(a, off); off += a.length; });
        return out;
      },
      equalBytes: (a, b) => {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
        return true;
      },
      export : (bytes) => {
        switch (self.globalConfig.fmt.export) {
          case 'base64' : return self.convert.bytesToBase64(bytes);
          case 'bytes'  : return bytes;
          case 'hex'    :
          default       : return self.convert.bytesToHex(bytes);
        }
      },
      /** Импорт ← строки/Uint8Array согласно текущему fmt */
      importToBytes : (data) => {
        if (data instanceof Uint8Array) return data;
        const fmt = self.globalConfig.fmt.export;
        return fmt === 'hex'    ? self.convert.hexToBytes(data)
              : fmt === 'base64' ? self.convert.base64ToBytes(data)
                                : self.convert.guessToBytes(data);
      },
      splitSig: p => {
        if (p.blocks) return p.blocks;        // уже готово
        const { originLen, blkLen, sigBytes, N } = p;
        const a = [sigBytes.slice(0, originLen)];
        for (let i = 0; i < N - 1; i++)
          a.push(sigBytes.slice(originLen + i*blkLen, originLen + (i+1)*blkLen));
        return a;
      }
    };
    /* ---------- crypto helpers ---------- */
    const self = this;
    this.enc = {
      hash: async (u8, alg = 'SHA-256') => new Uint8Array(await crypto.subtle.digest(alg, u8)),
      hashIter: async (u8, times, alg = 'SHA-256') => {
        let h = u8;
        for (let i = 0; i < times; i++) h = await self.enc.hash(h, alg);
        return h;
      },
      ladder: async (blocks, mode = 'S', alg = 'SHA-256') => {
        switch (mode) {
          case 'X': return self.enc._ladderX(blocks, alg);
          case 'S': return self.enc._ladderS(blocks, alg);
          default:  return self.enc._ladderS(blocks, alg);
        }
      },
      _ladderS: async (blocks, alg) => {
        const sigBlocks = [];
        for (let i = 0; i < blocks.length; i++) {
          sigBlocks.push(await self.enc.hashIter(blocks[i], i, alg));
        }
        return { sigBlocks, final: sigBlocks.at(-1) };
      },
      _ladderX: async (blocks, alg = 'SHA-256') => {
        if (!Array.isArray(blocks) || blocks.length === 0)
          throw new Error('_ladderX: blocks[] must be non‑empty array');
    
        const cat = self.convert.concatBytes;
        const sigBlocks = [blocks[0]];           // tₖ
        let prevRow = blocks;                    // текущая «горизонталь»
    
        for (let d = 1; d < blocks.length; d++) {
          /* считаем следующий ряд Fᵢᵈ = H(prev[i] ∥ prev[i+1]) */
          const curRow = [];
          for (let i = 0; i < prevRow.length - 1; i++)
            curRow.push(await self.enc.hash(cat(prevRow[i], prevRow[i + 1]), alg));
          sigBlocks.push(curRow[0]);             // F_d^d = вершина столбца d
          prevRow = curRow;
        }
        return { sigBlocks, final: sigBlocks.at(-1) };
      }
    };

    /* ---------- actions ---------- */
    this.actions = {
      /* --- подпись и упаковка --- */
      Sign: async pkg => {
        const p = this.actions.import.origin(pkg);
        const { origin, mode, alg, index, N } = p;
        const { sigBlocks } = await self.enc.ladder(origin, mode, alg);
        const sigBytes = self.convert.concatBytes(...sigBlocks);
        return this.actions.PackSignature(sigBytes, { index, N, mode, alg });
      },
      /* --- верификация двух подписей --- */
      VerifyS: async (oldSig, newSig) => {
        const older = oldSig.index < newSig.index ? oldSig : newSig;
        const newer = oldSig.index < newSig.index ? newSig : oldSig;
        const g = Number(newer.index - older.index);
        if (g <= 0 || g >= older.N) return false; // пропуск≥N невозможен
        if (older.originLen !== newer.originLen ||
            older.blkLen    !== newer.blkLen) return false;
        const oldBlocks = this.convert.splitSig(older);
        const newBlocks = this.convert.splitSig(newer);
        for (let i = 0; i < older.N - g; i++) {
          const hashed = await self.enc.hashIter(newBlocks[i], g, older.alg);
//        console.log("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",hashed,oldBlocks[i + g])
          if (!self.convert.equalBytes(hashed, oldBlocks[i + g])) return false;
        }
        return true;
      },
      VerifyX: async (sigA, sigB) => {
        /* упорядочим: older = Sₖ, newer = Sₖ₊₁ */
        const older = sigA.index < sigB.index ? sigA : sigB;
        const newer = sigA.index < sigB.index ? sigB : sigA;
        const g = Number(newer.index - older.index);
        if (g !== 1) return false;                // X разрешает только «+1»
    
        const { N } = older;
        /* разобьём sigBytes → массив блоков длиной N */
        if (older.sigBytes.length !== newer.sigBytes.length ||
            older.sigBytes.length % N !== 0) return false;
        const blkLen = older.sigBytes.length / N;
        const A = this.convert.splitSig(older);
        const B = this.convert.splitSig(newer);
        const cat = self.convert.concatBytes;
        /* правило:  A[d] ?= H( A[d‑1] ∥ B[d‑1] ),   d = 1…N‑1  */
        for (let d = 1; d < N; d++) {
          const expect = await self.enc.hash(cat(A[d - 1], B[d - 1]), older.alg);
          if (!self.convert.equalBytes(expect, A[d])) return false;
        }
        return true;                              // подпись Sₖ₊₁ принята
      },
      VerifyXS: async (sigA, sigB) => {
        const older = sigA.index < sigB.index ? sigA : sigB;
        const newer = sigA.index < sigB.index ? sigB : sigA;
        const g = Number(newer.index - older.index);
        if (g <= 0 || g >= older.N) return false;      // 1…N‑1

        /* восстановим полные лестницы */
        const rawOld = [older.diag[0], ...older.tail]; // tₖ … tₖ₊N‑1
        const rawNew = [newer.diag[0], ...newer.tail]; // tₖ₊g … tₖ₊g+N‑1
        const rowsOld = await self.enc._ladderFull(rawOld, older.alg);
        const rowsNew = await self.enc._ladderFull(rawNew, newer.alg);

        const N = older.N, cat = self.convert.concatBytes;
        /* правило перекрытия — точно как для «полной» X */
        for (let d = 0; d < N; d++) {
          const len = N - d;
          for (let i = 0; i < len - g; i++) {
            if (!self.convert.equalBytes(rowsOld[d][i+g], rowsNew[d][i]))
              return false;
          }
        }
        return true;
      },
      Verify: async (sigPkgA, sigPkgB) => {
        const A = this.actions.import.signature(sigPkgA);
        const B = this.actions.import.signature(sigPkgB);
        if (A.N !== B.N || A.mode !== B.mode || A.alg !== B.alg) return false;
        switch (A.mode) {
          case 'S': return this.actions.VerifyS(A, B);
          case 'X': return this.actions.VerifyX(A, B);
          default: return false;
        }
      },
            import : {
            /** Импорт подписи (бывший SigImporter) */
            signature : pkg => {
              const bytes = pkg instanceof Uint8Array ? pkg : self.convert.importToBytes(pkg);
              const headerLen = bytes[1];
              const N   = bytes[2];
              const mode= self.decoder.mode[bytes[3]] ?? 'U';
              const alg = self.decoder.algorithm[bytes[4]] ?? 'UNK';
              let idx=0n; for (let i=5;i<headerLen-1;i++) idx=(idx<<8n)|BigInt(bytes[i]);
              const sigBytes = bytes.slice(headerLen);
              const originLen = (self.globalConfig.sign.originSize ?? 256) >>> 3;
              const restLen   = sigBytes.length - originLen;
              const blkLen    = restLen / (N - 1);
              if (restLen < 0 || !Number.isInteger(blkLen))
                  throw new Error('SigImporter: wrong sizes');
              const blocks = [sigBytes.slice(0, originLen)];
              for (let i = 0; i < N - 1; i++)
                  blocks.push(sigBytes.slice(originLen + i*blkLen, originLen + (i+1)*blkLen));
              return {
                bytes, N, mode, alg, index: idx,
                sigBytes, originLen, blkLen, blocks
              }
            },
            origin : pkg => {
              const bytes = pkg instanceof Uint8Array ? pkg : self._importToBytes(pkg);
              const hdr = bytes[1];
              if (bytes[0] !== 0x00 || bytes[hdr - 1] !== 0x00) throw new Error('sentinel');
              const N = bytes[2], mode = self.decoder.mode[bytes[3]] ?? 'U', alg = self.decoder.algorithm[bytes[4]] ?? 'UNK';
              let idx = 0n; for (let i = 5; i < hdr - 1; i++) idx = (idx << 8n) | BigInt(bytes[i]);
              const body = bytes.slice(hdr);
              const blkLen = body.length / N; if (!Number.isInteger(blkLen)) throw new Error('div');
              const origin = []; for (let i = 0; i < N; i++) origin.push(body.slice(i * blkLen, (i + 1) * blkLen));
              return { bytes, N, mode, alg, index: idx, blockLen: blkLen, origin };
            }
    },

      OriginGenerator: () => {
        const { N, originSize } = self.globalConfig.sign;
        const len = originSize >>> 3;
        return { origin: Array.from({ length: N }, () => a.RandomBlock(len)) };
      },
      RandomBlock: len => { const u = new Uint8Array(len); crypto.getRandomValues(u); return u; },
      _buildHeader: (N, mode, alg, idxBytes) => {
        const hdrLen = 5 + idxBytes.length + 1;
        const h = new Uint8Array(hdrLen);
        h[0] = 0x00; h[1] = hdrLen & 0xff; h[2] = N & 0xff;
        h[3] = self.encoder.mode[mode] ?? 0xff; h[4] = self.encoder.algorithm[alg] ?? 0xff;
        h.set(idxBytes, 5); h[hdrLen - 1] = 0x00; return h;
      },
      NewExporter: (originObj, index = 0n) => {
        const { N, mode, hash } = self.globalConfig.sign;
        const hdr = a._buildHeader(N, mode, hash, self.convert.indexToBytes(index));
        return self.convert.export(self.convert.concatBytes(hdr, ...originObj.origin));
      },
      SignExporter: (sigBytes, index, N, mode, hash) => {
        const hdr = a._buildHeader(N, mode, hash, self.convert.indexToBytes(index));
        return self.convert.export(self.convert.concatBytes(hdr, sigBytes));
      },
      PackSignature: (sigBytes, meta) => {
        switch (self.globalConfig.sign.pack) {
          case 'simpleSig':
          default: return a.SignExporter(sigBytes, meta.index, meta.N, meta.mode, meta.alg);
        }
      },
      StepUp: pkg => {
        const p = a.import.origin(pkg);
        const { origin, blockLen, index } = p;
        const next = origin.slice(1); next.push(a.RandomBlock(blockLen));
        return a.NewExporter({ origin: next }, index + 1n);
      }
    };
    /* скопируем неизменённые методы из v1.2 */
    const a = this.actions; // alias for brevity (they were defined above)
  }

  /* ---------- PUBLIC API ---------- */
  async New(i = 0n) { return this.actions.NewExporter(this.actions.OriginGenerator(), i); }
  async stepUp(pkg) { return this.actions.StepUp(pkg); }
  async sign(pkg) { return this.actions.Sign(pkg); }
  async verify(sigA, sigB) { return this.actions.Verify(sigA, sigB); }
}