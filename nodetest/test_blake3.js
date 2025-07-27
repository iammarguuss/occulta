// test_blake3.js
// Запуск:  node test_blake3.js

/* ---------- среда и полифиллы ---------- */
const { webcrypto } = require('node:crypto');
globalThis.crypto = webcrypto;

globalThis.btoa ??= d => Buffer.from(d, 'binary').toString('base64');
globalThis.atob ??= b => Buffer.from(b, 'base64').toString('binary');

/* ---------- импорт алгоритма и класса ---------- */
const { blake3 } = require('hash-wasm');        // сторонний BLAKE3
const UldaSign     = require('./main.js');      // ваш класс (экспорт из main.js)

/* ---------- конфигурация с новой хэш‑функцией ---------- */
const signer = new UldaSign({
  fmt : { export : 'hex' },                     // подписи в hex‑виде (можно bytes/base64)
  sign: {
    N          : 5,
    mode       : 'X',
    hash       : 'BLAKE3',      // идентификатор, под которым регистрируем алгоритм
    originSize : 256,           // BLAKE3 выдаёт 256‑битовый digest
    /* ↓↓↓ регистрация функции: принимает Uint8Array, отдаёт hex‑строку */
    func       : async (u8) => blake3(u8),
    output     : 'hex'          // формат, который возвращает func (bytes/hex/base64)
  }
});

/* ---------- небольшой прогон ---------- */
const assert = require('node:assert/strict');

(async () => {
  // создаём цепочку «блок‑подпись»
  const v1 = await signer.New();
  const v2 = await signer.stepUp(v1);

  const s1 = await signer.sign(v1);
  const s2 = await signer.sign(v2);

  // проверяем: соседние версии верифицируются, через версию — нет
  assert(await signer.verify(s1, s2), 'v1 ↔ v2 должны подтверждаться');

  const v3 = await signer.stepUp(v2);
  const s3 = await signer.sign(v3);
  assert(!(await signer.verify(s1, s3)), 'v1 ↔ v3 НЕ должны подтверждаться');

  console.log('✅ ULDA‑Sign + BLAKE3 успешно отработали под Node!');
})();
