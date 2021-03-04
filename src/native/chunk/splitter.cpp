/* Copyright (C) 2016 NooBaa */
#include "splitter.h"

#include "../util/common.h"
#include "../util/endian.h"

namespace noobaa
{

// See https://web.eecs.utk.edu/~plank/plank/papers/CS-07-593/primitive-polynomial-table.txt
#define NB_RABIN_POLY 011
#define NB_RABIN_DEGREE 31
#define NB_RABIN_WINDOW_LEN 64

// intialize rabin instance statically for all splitter instances
// we set the rabin properties on compile time for best performance
// and it's not really valuable to make them dynamic
Rabin Splitter::_rabin(NB_RABIN_POLY, NB_RABIN_DEGREE, NB_RABIN_WINDOW_LEN);

Splitter::Splitter(
    int min_chunk,
    int max_chunk,
    int avg_chunk_bits,
    bool calc_md5,
    bool calc_sha256)
    : _min_chunk(min_chunk)
    , _max_chunk(max_chunk)
    , _avg_chunk_bits(avg_chunk_bits)
    , _calc_md5(calc_md5)
    , _calc_sha256(calc_sha256)
    , _window_pos(0)
    , _chunk_pos(0)
    , _hash(0)
    , _md5_ctx(0)
    , _sha256_ctx(0)
    , _md5_mb_ctx(0)
    , _md5_mb_mgr(0)
{
    assert(_min_chunk > 0);
    assert(_min_chunk <= _max_chunk);
    assert(_avg_chunk_bits >= 0);
    nb_buf_init_alloc(&_window, NB_RABIN_WINDOW_LEN);
    memset(_window.data, 0, _window.len);
    if (_calc_md5) {
        extern bool fips_mode;
        if (fips_mode) {
            posix_memalign((void**)&_md5_mb_mgr, 16, sizeof(MD5_HASH_CTX_MGR));
            posix_memalign((void**)&_md5_mb_ctx, 16, sizeof(MD5_HASH_CTX));
            md5_ctx_mgr_init(_md5_mb_mgr);
            hash_ctx_init(_md5_mb_ctx);
            md5_mb_submit_and_flush(0, 0, HASH_FIRST);
        } else {
            _md5_ctx = EVP_MD_CTX_new();
            EVP_DigestInit_ex(_md5_ctx, EVP_md5(), NULL);
        }
    }
    if (_calc_sha256) {
        _sha256_ctx = EVP_MD_CTX_new();
        EVP_DigestInit_ex(_sha256_ctx, EVP_sha256(), NULL);
    }
}

Splitter::~Splitter()
{
    nb_buf_free(&_window);
    if (_md5_ctx) EVP_MD_CTX_free(_md5_ctx);
    if (_sha256_ctx) EVP_MD_CTX_free(_sha256_ctx);
    if (_md5_mb_ctx) free(_md5_mb_ctx);
    if (_md5_mb_mgr) free(_md5_mb_mgr);
}

void
Splitter::push(const uint8_t* data, int len)
{
    if (_md5_ctx) EVP_DigestUpdate(_md5_ctx, data, len);
    if (_sha256_ctx) EVP_DigestUpdate(_sha256_ctx, data, len);
    if (_md5_mb_ctx) md5_mb_submit_and_flush(data, len, HASH_UPDATE);
    while (_next_point(&data, &len)) {
        _split_points.push_back(_chunk_pos);
        _chunk_pos = 0;
    }
}

void
Splitter::finish(uint8_t* md5, uint8_t* sha256)
{
    if (md5) {
        if (_md5_mb_ctx) {
            md5_mb_submit_and_flush(0, 0, HASH_LAST);
            uint32_t *digest = reinterpret_cast<uint32_t*>(md5);
            for (int i = 0; i < MD5_DIGEST_NWORDS; i++) {
                digest[i] = le32toh(hash_ctx_digest(_md5_mb_ctx)[i]);
            }
        } else if (_md5_ctx) {
            EVP_DigestFinal_ex(_md5_ctx, md5, 0);
        } else {
            PANIC("no md5 context");
        }
    }
    if (sha256) {
        if (_sha256_ctx) {
            EVP_DigestFinal_ex(_sha256_ctx, sha256, 0);
        } else {
            PANIC("no sha256 context");
        }
    }
}

bool
Splitter::_next_point(const uint8_t** const p_data, int* const p_len)
{
    // this code is very tight on CPU,
    // se we copy the memory that gets accessed frequently to the stack,
    // to be as close as possible to the CPU.

    int window_pos = _window_pos;
    const int window_len = _window.len;
    uint8_t* const window_data = _window.data;

    int chunk_pos = _chunk_pos;
    const int total = chunk_pos + (*p_len);
    const int min = total < _min_chunk ? total : _min_chunk;
    const int max = total < _max_chunk ? total : _max_chunk;

    Rabin::Hash hash = _hash;
    const Rabin::Hash avg_chunk_mask = ~(~((Rabin::Hash)0) << _avg_chunk_bits);
    const Rabin::Hash avg_chunk_val = ~((Rabin::Hash)0) & avg_chunk_mask;

    const uint8_t* data = *p_data;
    bool boundary = false;
    uint8_t byte = 0;

    // skip byte scanning as long as below min chunk length
    if (chunk_pos < min) {
        data += min - chunk_pos;
        chunk_pos = min;
    }

    // now the heavy part is to scan byte by byte,
    // update the rolling hash by adding the next byte and popping the old byte,
    // and check if the hash marks a chunk boundary.
    while (chunk_pos < max) {
        byte = *data;
        data++;
        chunk_pos++;

        hash = _rabin.update(hash, byte, window_data[window_pos]);
        if ((hash & avg_chunk_mask) == avg_chunk_val) {
            boundary = true;
            break;
        }

        window_data[window_pos] = byte;
        window_pos++;
        if (window_pos >= window_len) {
            window_pos = 0;
        }
    }

    if (boundary || chunk_pos >= _max_chunk) {
        const int n = (int)(data - (*p_data));
        memset(window_data, 0, window_len);
        _window_pos = 0;
        _chunk_pos = chunk_pos;
        _hash = 0;
        *p_data = data;
        *p_len -= n;
        return true;
    } else {
        _window_pos = window_pos;
        _chunk_pos = chunk_pos;
        _hash = hash;
        *p_data = 0;
        *p_len = 0;
        return false;
    }
}

} // namespace noobaa
