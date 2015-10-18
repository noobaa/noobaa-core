#ifndef NOOBAA__COMPRESSION__H
#define NOOBAA__COMPRESSION__H

#include "common.h"
#include "buf.h"

namespace noobaa {

/**
 * supported types: "zlib", "snappy"
 */
class Compression
{
public:
    static Buf compress(Buf buf, std::string type);
    static Buf decompress(Buf buf, int decompressed_len, std::string type);
};

} // namespace noobaa

#endif // NOOBAA__COMPRESSION__H
