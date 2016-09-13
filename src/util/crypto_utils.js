'use strict';

const bcrypt = require('bcrypt');
const P = require('./promise');
const argv = require('minimist')(process.argv);

// This is to support shell scripts
// It is used in order to bcrypt support account password in mongo_upgrade
if (argv.bcrypt_password) {
    return bcrypt_password(argv.bcrypt_password).then(console.log);
}

function bcrypt_password(password) {
    return P.resolve()
        .then(() => P.fromCallback(callback =>
            bcrypt.genSalt(10, callback)))
        .then(salt => P.fromCallback(callback =>
            bcrypt.hash(password, salt, callback)))
        .then(password_hash => {
            password = password_hash;
            return password;
        });
}

// EXPORTS
exports.bcrypt_password = bcrypt_password;
