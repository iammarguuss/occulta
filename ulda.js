const crypto = require('crypto');

class UldaAuth {
  constructor(privateKey, publicKey) {
    this.privateKey = privateKey;
    this.publicKey = publicKey;
  }

  static generateKeys() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    return { publicKey, privateKey };
  }

  sign(data) {
    return crypto.sign(null, Buffer.from(data), this.privateKey);
  }

  verify(data, signature) {
    return crypto.verify(null, Buffer.from(data), this.publicKey, signature);
  }
}

module.exports = UldaAuth;
