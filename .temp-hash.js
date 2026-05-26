const crypto = require('crypto');
const password = 'admin123';
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync(password, salt, 64).toString('hex');
const passwordHash = salt + ':' + hash;
console.log('Password: ' + password);
console.log('Hash: ' + passwordHash);
