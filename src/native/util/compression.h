#ifndef NB__COMPRESSION__H
#define NB__COMPRESSION__H

#include "common.h"
#include "buf.h"

/**
 * supported types: "zlib", "snappy"
 */
class Compression
{
public:
    static Buf compress(Buf buf, std::string type);
    static Buf decompress(Buf buf, int decompressed_len, std::string type);
};

#endif // NB__COMPRESSION__H
