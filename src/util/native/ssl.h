#ifndef SSL_H_
#define SSL_H_

#include "common.h"
#include "buf.h"

#include <openssl/evp.h>
#include <openssl/sha.h>
#include <openssl/err.h>

extern const char* BYTE_TO_HEX[256];

extern void ssl_init();
extern void ssl_destroy();

class Digest
{
public:
    Digest() : _digest_len(0)
    {
    }

    void sha256(Buf buf)
    {
        EVP_MD_CTX ctx;
        EVP_MD_CTX_init(&ctx);
        EVP_DigestInit_ex(&ctx, EVP_sha256(), NULL);
        EVP_DigestUpdate(&ctx, buf.data(), buf.length());
        EVP_DigestFinal_ex(&ctx, _digest, &_digest_len);
        /*
           SHA256_CTX ctx;
           SHA256_Init(&ctx);
           SHA256_Update(&ctx, buf.data(), buf.length());
           SHA256_Final(_digest, &ctx);
           _digest_len = SHA256_DIGEST_LENGTH;
         */
    }

    std::string to_string() const
    {
        std::stringstream stream;
        stream << *this;
        return stream.str();
    }

    friend std::ostream& operator<<(std::ostream& os, const Digest& d) {
        for (uint32_t i=0; i<d._digest_len; ++i) {
            os << BYTE_TO_HEX[d._digest[i]];
        }
        return os;
    }

private:
    uint8_t _digest[EVP_MAX_MD_SIZE];
    uint32_t _digest_len;
};

#endif // SSL_H_
