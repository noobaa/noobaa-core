// module targets: nodejs & browserify
'use strict';

var Q = require('q');
var crypto = require('crypto');
var subtle_crypto = global && global.crypto && global.crypto.subtle;
if (subtle_crypto) {
    var evp_bytes_to_key = require('browserify-aes/EVP_BytesToKey');
}
var buffer_utils = require('../util/buffer_utils');

/**
 *
 * this module provides encrypt/decrypt functions which are optimized
 * to work both in browsers (WebCrypto) and in nodejs using native api's.
 * if native is not available we fallback to pure slow javascript (by browserify-crypto).
 *
 */
module.exports = {
    encrypt_chunk: encrypt_chunk,
    decrypt_chunk: decrypt_chunk
};



/**
 *
 * encrypt_chunk
 *
 * @param crypt_info (object) should contain cipher_type and hash_type
 *      and will be added cypher_val and hash_val
 *
 */
function encrypt_chunk(plain_buffer, crypt_info) {

    return Q.fcall(function() {
        return digest_hash_base64(crypt_info.hash_type, plain_buffer);

    }).then(function(hash_val) {



        // convergent encryption - use data hash as cipher key
        crypt_info.cipher_val = hash_val;
        crypt_info.hash_val = hash_val;

        // WebCrypto optimization
        // the improvement is drastic in supported browsers
        // over pure js code from crypto-browserify
        if (subtle_crypto && crypt_info.cipher_type === 'aes256') {
            var keys = evp_bytes_to_key(crypt_info.cipher_val, 256, 16);

            var keyToUse = buffer_utils.toArrayBuffer(keys.key);

            return subtle_crypto.importKey('raw', keyToUse, {
                    name: "AES-CBC",
                    length: 256
                }, false, ['encrypt'])
                .then(function(key) {
                    var iv;
                    if (buffer_utils.isAbv(keys.iv)) {
                        iv = keys.iv;
                    } else {
                        iv = buffer_utils.toArrayBufferView(keys.iv);
                    }
                    var plnBuf = buffer_utils.toArrayBuffer(plain_buffer);

                    return subtle_crypto.encrypt({
                        name: "AES-CBC",
                        length: 256,
                        iv: iv,
                    }, key, plnBuf);
                })
                .then(function(encrypted_array) {
                    var encrypted_buffer = new Buffer(new Uint8Array(encrypted_array));
                    return encrypted_buffer;
                }).then(null, function(err){
                    console.error('encrypt_chunk error:'+err);
                });
        }

        // use node.js crypto cipher api
        var cipher = crypto.createCipher(crypt_info.cipher_type, crypt_info.cipher_val);
        var encrypted_buffer = cipher.update(plain_buffer);
        var cipher_final = cipher.final();
        if (cipher_final && cipher_final.length) {
            encrypted_buffer = Buffer.concat([encrypted_buffer, cipher_final]);
        }
        return encrypted_buffer;
    });
}


/**
 *
 * decrypt_chunk
 *
 * @param crypt_info (object) should contain cipher_type, cypher_val, hash_type, hash_val
 *
 */
function decrypt_chunk(encrypted_buffer, crypt_info) {
    var plain_buffer;

    return Q.fcall(function() {

        // WebCrypto optimization
        // the improvement is drastic in supported browsers
        // over pure js code from crypto-browserify
        if (subtle_crypto && crypt_info.cipher_type === 'aes256') {
            var keys = evp_bytes_to_key(crypt_info.cipher_val, 256, 16);

            var keyToUse = buffer_utils.toArrayBuffer(keys.key);

            return subtle_crypto.importKey('raw', keyToUse, {
                    name: "AES-CBC",
                    length: 256
                }, false, ['decrypt'])
                .then(function(key) {

                    var encBuf = buffer_utils.toArrayBuffer(encrypted_buffer);
                    var iv;
                    if (buffer_utils.isAbv(keys.iv)) {
                        iv = keys.iv;
                    } else {
                        iv = buffer_utils.toArrayBufferView(keys.iv);
                    }

                    return subtle_crypto.decrypt({
                        name: "AES-CBC",
                        length: 256,
                        iv: iv,
                    }, key, encBuf);
                })
                .then(function(plain_array) {
                    plain_buffer = new Buffer(new Uint8Array(plain_array));
                });
        }

        // use node.js crypto decipher api
        var decipher = crypto.createDecipher(
            crypt_info.cipher_type, crypt_info.cipher_val);
        plain_buffer = decipher.update(encrypted_buffer);
        var decipher_final = decipher.final();
        if (decipher_final && decipher_final.length) {
            plain_buffer = Buffer.concat([plain_buffer, decipher_final]);
        }

    }).then(function() {
        return digest_hash_base64(crypt_info.hash_type, plain_buffer);

    }).then(function(hash_val) {
        if (hash_val !== crypt_info.hash_val) {
            console.error('HASH CHECKSUM FAILED', hash_val, crypt_info);
            throw new Error('hash checksum failed');
        }
        return plain_buffer;
    });
}


function digest_hash_base64(hash_type, buffer) {

    var plnBuf = buffer_utils.toArrayBuffer(buffer);

    // WebCrypto optimization
    if (subtle_crypto && hash_type === 'sha256') {
        return subtle_crypto.digest({
                name: 'SHA-256'
            }, plnBuf)
            .then(function(hash_digest) {
                var hash_val = new Buffer(new Uint8Array(hash_digest)).toString('base64');
                return hash_val;
            });
    }

    // use node.js crypto hash api
    var hasher = crypto.createHash(hash_type);
    hasher.update(buffer);
    var hash_val = hasher.digest('base64');
    return hash_val;
}
