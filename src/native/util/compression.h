/* Copyright (C) 2016 NooBaa */
#pragma once

#include "buf.h"
#include "common.h"

namespace noobaa
{

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
