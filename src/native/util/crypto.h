/* Copyright (C) 2016 NooBaa */
#pragma once

#include <openssl/err.h>
#include <openssl/evp.h>
#include <openssl/rand.h>
#include <openssl/sha.h>

#include "buf.h"
#include "common.h"
#include "nan.h"

namespace noobaa
{

class Crypto
{

public:
    static NAN_MODULE_INIT(setup);
    static NAN_METHOD(rsa);
    static NAN_METHOD(x509);
    static NAN_METHOD(x509_verify);

    static inline Buf
    digest(const Buf& buf, const char* digest_name)
    {
        const EVP_MD* md = EVP_get_digestbyname(digest_name);
        ASSERT(md, DVAL(digest_name));
        Buf digest(EVP_MD_size(md));
        uint32_t digest_len;
        EVP_MD_CTX *ctx_md = EVP_MD_CTX_new();
        EVP_DigestInit_ex(ctx_md, md, NULL);
        EVP_DigestUpdate(ctx_md, buf.data(), buf.length());
        EVP_DigestFinal_ex(ctx_md, digest.data(), &digest_len);
        EVP_MD_CTX_free(ctx_md);
        digest.slice(0, digest_len);
        return digest;
    }

    static inline Buf
    hmac(const Buf& buf, const Buf& key, const char* digest_name)
    {
        const EVP_MD* md = EVP_get_digestbyname(digest_name);
        ASSERT(md, DVAL(digest_name));
        Buf digest(EVP_MD_size(md));
        size_t digest_len;
        EVP_PKEY_CTX* pctx = NULL;
        EVP_PKEY* pkey = EVP_PKEY_new_mac_key(EVP_PKEY_HMAC, NULL, key.data(), key.length());
        EVP_MD_CTX *ctx_md = EVP_MD_CTX_new();
        EVP_DigestSignInit(ctx_md, &pctx, md, NULL, pkey);
        EVP_DigestSignUpdate(ctx_md, buf.data(), buf.length());
        EVP_DigestSignFinal(ctx_md, digest.data(), &digest_len);
        EVP_MD_CTX_free(ctx_md);
        EVP_PKEY_free(pkey);
        digest.slice(0, digest_len);
        return digest;
    }

    static Buf
    encrypt(const Buf& buf, const char* cipher_name, const Buf& key, const Buf& iv)
    {
        const EVP_CIPHER* cipher = _get_cipher(cipher_name, key, iv);
        int out_len = 0;
        int final_len = 0;
        EVP_CIPHER_CTX *ctx = EVP_CIPHER_CTX_new();
        EVP_EncryptInit_ex(ctx, cipher, NULL, key.data(), iv.length() ? iv.data() : NULL);
        Buf out(buf.length() + EVP_CIPHER_CTX_block_size(ctx));
        EVP_EncryptUpdate(ctx, out.data(), &out_len, buf.data(), buf.length());
        EVP_EncryptFinal_ex(ctx, out.data() + out_len, &final_len);
        EVP_CIPHER_CTX_free(ctx);
        out.slice(0, out_len + final_len);
        return out;
    }

    static Buf
    decrypt(const Buf& buf, const char* cipher_name, const Buf& key, const Buf& iv)
    {
        const EVP_CIPHER* cipher = _get_cipher(cipher_name, key, iv);
        int out_len = 0;
        int final_len = 0;
        Buf out(buf.length());
        EVP_CIPHER_CTX *ctx = EVP_CIPHER_CTX_new();
        EVP_DecryptInit_ex(ctx, cipher, NULL, key.data(), iv.length() ? iv.data() : NULL);
        EVP_DecryptUpdate(ctx, out.data(), &out_len, buf.data(), buf.length());
        EVP_DecryptFinal_ex(ctx, out.data() + out_len, &final_len);
        EVP_CIPHER_CTX_free(ctx);
        out.slice(0, out_len + final_len);
        return out;
    }

private:
    static const EVP_CIPHER*
    _get_cipher(const char* cipher_name, const Buf& key, const Buf& iv)
    {
        const EVP_CIPHER* cipher = EVP_get_cipherbyname(cipher_name);
        ASSERT(cipher, DVAL(cipher_name));
        ASSERT(
            key.length() == EVP_CIPHER_key_length(cipher), DVAL(key.length()) << DVAL(EVP_CIPHER_key_length(cipher)));
        // iv is required if the key is reused, but can be empty if the key is unique
        ASSERT(iv.length() >= EVP_CIPHER_iv_length(cipher) || iv.length() == 0, DVAL(iv.length()) << DVAL(EVP_CIPHER_iv_length(cipher)));
        return cipher;
    }
};

} // namespace noobaa
