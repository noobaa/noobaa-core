/* Copyright (C) 2024 NooBaa */
'use strict';

const CRYPTO_SALT_BUFFER_SIZE = 8;
const CRYPTO_SALT_KEY_LENGTH = 32;
const CRYPTO_PBKDF2_ITERATIONS = 100;

const crypto = require('crypto');

function create_node_password_hash(password) {
    return new Promise((resolve, reject) => {
        const salt = crypto.randomBytes(CRYPTO_SALT_BUFFER_SIZE).toString('hex');
        crypto.pbkdf2(password, salt, CRYPTO_PBKDF2_ITERATIONS, CRYPTO_SALT_KEY_LENGTH, 'sha512', (err, derivedKey) => {
            if (err) {
                reject(err);
                return err;
            }
            resolve(salt + ':' + derivedKey.toString('hex'));
        });
    });
}

function verify_node_password_hash(password, hashedPassword) {
    return new Promise((resolve, reject) => {
        const [salt, key] = hashedPassword.split(':');
        crypto.pbkdf2(password, salt, CRYPTO_PBKDF2_ITERATIONS, CRYPTO_SALT_KEY_LENGTH, 'sha512', (err, derivedKey) => {
            if (err) {
                reject(err);
                return err;
            }
            resolve(key === derivedKey.toString('hex'));
        });
    });
}


exports.create_node_password_hash = create_node_password_hash;
exports.verify_node_password_hash = verify_node_password_hash;
