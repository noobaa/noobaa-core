#include "crypto.h"

void
Crypto::init()
{
    std::cout << "OPENSSL " << SSLeay_version(SSLEAY_VERSION) << std::endl;
    OpenSSL_add_all_algorithms();
    OpenSSL_add_all_ciphers();
    OpenSSL_add_all_digests();
}

void
Crypto::destroy()
{
}
