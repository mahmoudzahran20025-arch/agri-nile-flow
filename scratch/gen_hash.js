const crypto = require('crypto');

function hashPassword(password, salt) {
  // auth.ts uses: enc.encode(salt) which means it treats the salt string as UTF-8 bytes
  return crypto.pbkdf2Sync(password, Buffer.from(salt, 'utf-8'), 100000, 32, 'sha256').toString('base64');
}

const salt = crypto.randomBytes(16).toString('base64');
const hash = hashPassword('Admin@2025', salt);

console.log(`SALT: ${salt}`);
console.log(`HASH: ${hash}`);
