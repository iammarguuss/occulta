// test_ulda.js
// Запускать:  node test_ulda.js

/* ---------- Глобалы & полифиллы ---------- */
const { webcrypto } = require('node:crypto');
globalThis.crypto = webcrypto;                         // WebCrypto API

globalThis.btoa ??= data => Buffer.from(data, 'binary').toString('base64');
globalThis.atob ??= b64  => Buffer.from(b64, 'base64').toString('binary');

/* ---------- Импорт класса ---------- */
const UldaSign = require('./main.js');                 // после правки «module.exports»

/* ---------- Конфиг и самотест ---------- */
(async () => {
  const signer = new UldaSign({
    fmt : { export : 'bytes' },
    sign: { N: 5, mode: 'X', hash: 'SHA-256', originSize: 256 }
  });

  // Cоздадим цепочку исходников
  const v1 = await signer.New();
  const v2 = await signer.stepUp(v1);
  const v3 = await signer.stepUp(v2);

  // Подписи
  const s1 = await signer.sign(v1);
  const s2 = await signer.sign(v2);
  const s3 = await signer.sign(v3);

  // Проверки
  const assert = require('node:assert/strict');
  assert(await signer.verify(s1, s2), 's1 ↔ s2 должны верифицироваться');
  assert(await signer.verify(s2, s3), 's2 ↔ s3 должны верифицироваться');
  assert(!(await signer.verify(s1, s3)), 's1 ↔ s3 должны НЕ верифицироваться');

  console.log('✅  ULDA Sign успешно прошёл базовый тест под Node!');
})();
