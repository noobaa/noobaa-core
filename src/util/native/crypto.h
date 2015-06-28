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

    static inline std::string digest(const char* name, Buf buf)
    {
        uint8_t digest[EVP_MAX_MD_SIZE];
        uint32_t digest_len;
        EVP_MD_CTX ctx;
        EVP_MD_CTX_init(&ctx);
        const EVP_MD *md = EVP_get_digestbyname(name);
        EVP_DigestInit_ex(&ctx, md, NULL);
        EVP_DigestUpdate(&ctx, buf.data(), buf.length());
        EVP_DigestFinal_ex(&ctx, digest, &digest_len);
        std::string str;
        for (uint32_t i=0; i<digest_len; ++i) {
            str += BYTE_TO_HEX[digest[i]];
        }
        return str;
    }

    static inline Buf aes256(Buf buf)
    {
        // EVP_aes_256_cbc
        return buf;
    }

private:
    static const char* BYTE_TO_HEX[256];
};

#endif // CRYPTO_H_
