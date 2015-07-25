#ifndef CRYPTO_H_
#define CRYPTO_H_

#include "common.h"
#include "buf.h"

#include <openssl/evp.h>
#include <openssl/sha.h>
#include <openssl/err.h>
#include <openssl/rand.h>

class Crypto
{
public:

    static void init();
    static void destroy();

    static inline Buf digest(const Buf& buf, const char* digest_name)
    {
        const EVP_MD *md = EVP_get_digestbyname(digest_name);
        Buf digest(EVP_MD_size(md));
        uint32_t digest_len;
        EVP_MD_CTX ctx_md;
        EVP_MD_CTX_init(&ctx_md);
        EVP_DigestInit_ex(&ctx_md, md, NULL);
        EVP_DigestUpdate(&ctx_md, buf.data(), buf.length());
        EVP_DigestFinal_ex(&ctx_md, digest.data(), &digest_len);
        EVP_MD_CTX_cleanup(&ctx_md);
        digest.slice(0, digest_len);
        return digest;
    }

    static inline Buf hmac(const Buf& buf, const Buf& key, const char* digest_name)
    {
        const EVP_MD *md = EVP_get_digestbyname(digest_name);
        Buf digest(EVP_MD_size(md));
        size_t digest_len;
        EVP_PKEY_CTX *pctx = NULL;
        EVP_PKEY *pkey = EVP_PKEY_new_mac_key(EVP_PKEY_HMAC, NULL, key.data(), key.length());
        EVP_MD_CTX ctx_md;
        EVP_MD_CTX_init(&ctx_md);
        EVP_DigestSignInit(&ctx_md, &pctx, md, NULL, pkey);
        EVP_DigestSignUpdate(&ctx_md, buf.data(), buf.length());
        EVP_DigestSignFinal(&ctx_md, digest.data(), &digest_len);
        EVP_MD_CTX_cleanup(&ctx_md);
        EVP_PKEY_free(pkey);
        digest.slice(0, digest_len);
        return digest;
    }

    static Buf encrypt(const Buf& buf, const Buf& key, const Buf& iv, const char* cipher_name)
    {
        const EVP_CIPHER *cipher = EVP_get_cipherbyname(cipher_name);
        ASSERT(key.length() == EVP_CIPHER_key_length(cipher),
            DVAL(key.length()) << DVAL(EVP_CIPHER_key_length(cipher)));
        // iv is required if the key is reused, but can be empty if the key is unique
        ASSERT(iv.length() >= EVP_CIPHER_iv_length(cipher) || iv.length() == 0,
            DVAL(iv.length()) << DVAL(EVP_CIPHER_iv_length(cipher)));
        EVP_CIPHER_CTX ctx_cipher;
        EVP_CIPHER_CTX_init(&ctx_cipher);
        EVP_EncryptInit_ex(&ctx_cipher, cipher, NULL, NULL, NULL);
        EVP_EncryptInit_ex(&ctx_cipher, cipher, NULL, key.data(), iv.length() ? iv.data() : NULL);
        int out_len = 0;
        int final_len = 0;
        const int AUTH_TAG_LEN = 16;
        Buf out(buf.length() + EVP_CIPHER_CTX_block_size(&ctx_cipher) + AUTH_TAG_LEN);
        EVP_EncryptUpdate(&ctx_cipher, out.data(), &out_len, buf.data(), buf.length());
        EVP_EncryptFinal_ex(&ctx_cipher, out.data() + out_len, &final_len);
        EVP_CIPHER_CTX_ctrl(&ctx_cipher, EVP_CTRL_GCM_GET_TAG, AUTH_TAG_LEN, out.data() + out_len + final_len);
        EVP_CIPHER_CTX_cleanup(&ctx_cipher);
        out.slice(0, out_len + final_len + AUTH_TAG_LEN);
        return out;
    }

    static Buf decrypt(const Buf& buf, const Buf& key, const Buf& iv, const char* cipher_name)
    {
        const EVP_CIPHER *cipher = EVP_get_cipherbyname(cipher_name);
        ASSERT(key.length() == EVP_CIPHER_key_length(cipher),
            DVAL(key.length()) << DVAL(EVP_CIPHER_key_length(cipher)));
        // iv is required if the key is reused, but can be empty if the key is unique
        ASSERT(iv.length() >= EVP_CIPHER_iv_length(cipher) || iv.length() == 0,
            DVAL(iv.length()) << DVAL(EVP_CIPHER_iv_length(cipher)));
        EVP_CIPHER_CTX ctx_cipher;
        EVP_CIPHER_CTX_init(&ctx_cipher);
        EVP_DecryptInit_ex(&ctx_cipher, cipher, NULL, NULL, NULL);
        EVP_DecryptInit_ex(&ctx_cipher, cipher, NULL, key.data(), iv.length() ? iv.data() : NULL);
        int out_len = 0;
        int final_len = 0;
        Buf out(buf.length());
        EVP_DecryptUpdate(&ctx_cipher, out.data(), &out_len, buf.data(), buf.length());
        EVP_DecryptFinal_ex(&ctx_cipher, out.data() + out_len, &final_len);
        // EVP_CIPHER_CTX_ctrl(&ctx_cipher, EVP_CTRL_GCM_GET_TAG, AUTH_TAG_LEN, out.data() + out_len + final_len);
        EVP_CIPHER_CTX_cleanup(&ctx_cipher);
        // out.slice(0, out_len + final_len + AUTH_TAG_LEN);
        return out;
    }

};

#endif // CRYPTO_H_
