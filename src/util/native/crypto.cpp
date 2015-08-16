#include "crypto.h"

void
Crypto::init()
{
    LOG("OPENSSL " << SSLeay_version(SSLEAY_VERSION));
    OpenSSL_add_all_algorithms();
    OpenSSL_add_all_ciphers();
    OpenSSL_add_all_digests();
}

void
Crypto::destroy()
{
}
