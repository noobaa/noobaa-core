#ifndef CRYPTO_H_
#define CRYPTO_H_

#include "common.h"
#include "buf.h"

#include <openssl/evp.h>
#include <openssl/sha.h>
#include <openssl/err.h>

class Crypto
{
public:

    static void init();
    static void destroy();

    static EVP_MD_CTX ctx_md;

    static inline std::string digest(const char* digest_name, Buf buf)
    {
        const EVP_MD *md = EVP_get_digestbyname(digest_name);
        uint8_t digest[EVP_MAX_MD_SIZE];
        uint32_t digest_len;
        // EVP_MD_CTX ctx_md;
        // EVP_MD_CTX_init(&ctx_md);
        EVP_DigestInit_ex(&ctx_md, md, NULL);
        EVP_DigestUpdate(&ctx_md, buf.data(), buf.length());
        EVP_DigestFinal_ex(&ctx_md, digest, &digest_len);
        // EVP_MD_CTX_cleanup(&ctx_md);
        std::string str;
        for (uint32_t i=0; i<digest_len; ++i) {
            str += BYTE_TO_HEX[digest[i]];
        }
        return str;
    }

    static inline Buf encrypt(const char* cipher_name, Buf buf)
    {
        const EVP_CIPHER *cipher = EVP_get_cipherbyname(cipher_name);
        EVP_CIPHER_CTX ctx_cipher;
        EVP_CIPHER_CTX_init(&ctx_cipher);
        EVP_EncryptInit_ex(&ctx_cipher, cipher, NULL, NULL, NULL);
        // EVP_EncryptUpdate(&ctx_cipher, out, &out_len, buf.data(), buf.length());
        // EVP_EncryptFinal_ex(&ctx_cipher, out, &out_len);
        EVP_CIPHER_CTX_cleanup(&ctx_cipher);
        return buf;
    }

private:
    static const char* BYTE_TO_HEX[256];
};

#endif // CRYPTO_H_
