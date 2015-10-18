#ifndef NOOBAA__CRYPTO__H
#define NOOBAA__CRYPTO__H

#include "common.h"
#include "buf.h"

#include <openssl/evp.h>
#include <openssl/sha.h>
#include <openssl/err.h>
#include <openssl/rand.h>

namespace noobaa {

class Crypto
{
public:

    static void init();
    static void destroy();

    static inline Buf digest(const Buf& buf, const char* digest_name)
    {
        const EVP_MD *md = EVP_get_digestbyname(digest_name);
        ASSERT(md, DVAL(digest_name));
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
        ASSERT(md, DVAL(digest_name));
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

    static Buf encrypt(const Buf& buf, const char* cipher_name, const Buf& key, const Buf& iv)
    {
        Cipher c(cipher_name, key, iv);
        return c.encrypt(buf);
    }

    static Buf decrypt(const Buf& buf, const char* cipher_name, const Buf& key, const Buf& iv)
    {
        Cipher c(cipher_name, key, iv);
        return c.decrypt(buf);
    }

    class Cipher
    {
private:
        const EVP_CIPHER *_cipher;
        EVP_CIPHER_CTX _ctx_cipher;
        Buf _key;
        Buf _iv;
public:
        Cipher(const char* cipher_name, const Buf& key, const Buf& iv)
            : _cipher(EVP_get_cipherbyname(cipher_name))
            , _key(key)
            , _iv(iv)
        {
            EVP_CIPHER_CTX_init(&_ctx_cipher);
            ASSERT(_cipher, DVAL(cipher_name));
            ASSERT(key.length() == EVP_CIPHER_key_length(_cipher),
                   DVAL(key.length()) << DVAL(EVP_CIPHER_key_length(_cipher)));
            // iv is required if the key is reused, but can be empty if the key is unique
            ASSERT(iv.length() >= EVP_CIPHER_iv_length(_cipher) || iv.length() == 0,
                   DVAL(iv.length()) << DVAL(EVP_CIPHER_iv_length(_cipher)));
        }
        ~Cipher()
        {
            EVP_CIPHER_CTX_cleanup(&_ctx_cipher);
        }
        Buf encrypt(const Buf& buf)
        {
            int out_len = 0;
            int final_len = 0;
            EVP_EncryptInit_ex(&_ctx_cipher, _cipher, NULL, _key.data(), _iv.length() ? _iv.data() : NULL);
            Buf out(buf.length() + EVP_CIPHER_CTX_block_size(&_ctx_cipher));
            EVP_EncryptUpdate(&_ctx_cipher, out.data(), &out_len, buf.data(), buf.length());
            EVP_EncryptFinal_ex(&_ctx_cipher, out.data() + out_len, &final_len);
            out.slice(0, out_len + final_len);
            return out;
        }
        Buf decrypt(const Buf& buf)
        {
            int out_len = 0;
            int final_len = 0;
            Buf out(buf.length());
            EVP_DecryptInit_ex(&_ctx_cipher, _cipher, NULL, _key.data(), _iv.length() ? _iv.data() : NULL);
            EVP_DecryptUpdate(&_ctx_cipher, out.data(), &out_len, buf.data(), buf.length());
            EVP_DecryptFinal_ex(&_ctx_cipher, out.data() + out_len, &final_len);
            out.slice(0, out_len + final_len);
            return out;
        }
        void gcm_get_auth_tag(Buf auth_tag)
        {
            // call gcm_get_auth_tag AFTER encrypt
            EVP_CIPHER_CTX_ctrl(&_ctx_cipher, EVP_CTRL_GCM_GET_TAG, auth_tag.length(), auth_tag.data());
        }
        void gcm_set_auth_tag(Buf auth_tag)
        {
            // call gcm_set_auth_tag BEFORE decrypt
            EVP_CIPHER_CTX_ctrl(&_ctx_cipher, EVP_CTRL_GCM_SET_TAG, auth_tag.length(), auth_tag.data());
        }
    };

};

} // namespace noobaa

#endif // NOOBAA__CRYPTO__H
