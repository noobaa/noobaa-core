/* Copyright (C) 2016 NooBaa */
#pragma once

#include <vector>

#include <openssl/evp.h>

#include "../util/rabin.h"
#include "../util/struct_buf.h"
#include "../third_party/isa-l_crypto/include/md5_mb.h"

namespace noobaa
{

class Splitter
{
public:
    typedef int Point;
    typedef std::vector<Point> Points;

    Splitter(
        int min_chunk,
        int max_chunk,
        int avg_chunk_bits,
        bool calc_md5,
        bool calc_sha256);

    ~Splitter();

    void push(const uint8_t* data, int len);

    void finish(uint8_t* md5, uint8_t* sha256);

    bool calc_md5() { return _calc_md5; }
    bool calc_sha256() { return _calc_sha256; }
    Points extract_points() { return std::move(_split_points); }

private:
    const int _min_chunk;
    const int _max_chunk;
    const int _avg_chunk_bits;
    const bool _calc_md5;
    const bool _calc_sha256;

    struct NB_Buf _window;
    int _window_pos;
    Points _split_points;
    Point _chunk_pos;
    Rabin::Hash _hash;

    EVP_MD_CTX* _md5_ctx;
    EVP_MD_CTX* _sha256_ctx;
    MD5_HASH_CTX* _md5_mb_ctx;
    MD5_HASH_CTX_MGR* _md5_mb_mgr;

    void md5_mb_submit_and_flush(const void* data, uint32_t size, HASH_CTX_FLAG flag)
    {
        md5_ctx_mgr_submit(_md5_mb_mgr, _md5_mb_ctx, data, size, flag);
        while (hash_ctx_processing(_md5_mb_ctx)) {
            md5_ctx_mgr_flush(_md5_mb_mgr);
        }
    }

    static Rabin _rabin;

    bool _next_point(const uint8_t** const p_data, int* const p_len);
};

} // namespace noobaa
