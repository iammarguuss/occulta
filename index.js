const UldaAuth = require('./ulda');

const { publicKey, privateKey } = UldaAuth.generateKeys();
const ulda = new UldaAuth(privateKey, publicKey);

const message = 'ULDA authentication demo';
const signature = ulda.sign(message);

console.log('Signature (hex):', signature.toString('hex'));
console.log('Valid:', ulda.verify(message, signature));
