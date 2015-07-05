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

#define HEXED(x) \
    x "0", x "1", x "2", x "3", \
    x "4", x "5", x "6", x "7", \
    x "8", x "9", x "a", x "b", \
    x "c", x "d", x "e", x "f"

const char*
Crypto::BYTE_TO_HEX[] = {
    HEXED("0"), HEXED("1"), HEXED("2"), HEXED("3"),
    HEXED("4"), HEXED("5"), HEXED("6"), HEXED("7"),
    HEXED("8"), HEXED("9"), HEXED("a"), HEXED("b"),
    HEXED("c"), HEXED("d"), HEXED("e"), HEXED("f")
};
