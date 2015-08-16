#ifndef COMPRESS_H_
#define COMPRESS_H_

#include "common.h"
#include "buf.h"

/**
 * supported types: "zlib", "snappy"
 */
class Compression
{
public:
    static Buf compress(Buf buf, std::string type);
    static Buf decompress(Buf buf, std::string type);
};

#endif // COMPRESS_H_
