/* Copyright (C) 2016 NooBaa */
#include "coder.h"

#include <assert.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <openssl/err.h>
#include <openssl/evp.h>
#include <openssl/rand.h>
#include <openssl/sha.h>

#include "../third_party/cm256/cm256.h"
#include "../third_party/isa-l/include/erasure_code.h"
#include "../util/b64.h"
#include "../util/common.h"
#include "../util/snappy.h"
#include "../util/zlib.h"

namespace noobaa
{

#define MAX_DATA_FRAGS 32
#define MAX_PARITY_FRAGS 32
#define MAX_TOTAL_FRAGS (MAX_DATA_FRAGS + MAX_PARITY_FRAGS)
#define MAX_MATRIX_SIZE (MAX_DATA_FRAGS * MAX_TOTAL_FRAGS)

// for now just ignore the auth tag to save performance
// our chunk digest is already covering for data integrity
#define USE_GCM_AUTH_TAG false

static void _nb_encode(struct NB_Coder_Chunk* chunk);
static void _nb_encrypt(struct NB_Coder_Chunk* chunk, const EVP_CIPHER* evp_cipher);
static void _nb_no_encrypt(struct NB_Coder_Chunk* chunk);
static void _nb_erasure(struct NB_Coder_Chunk* chunk);

static void _nb_decode(struct NB_Coder_Chunk* chunk);
static void
_nb_derasure(struct NB_Coder_Chunk* chunk, struct NB_Coder_Frag** frags_map, int total_frags);
static void _nb_decrypt(
    struct NB_Coder_Chunk* chunk, struct NB_Coder_Frag** frags_map, const EVP_CIPHER* evp_cipher);
static void _nb_no_decrypt(struct NB_Coder_Chunk* chunk, struct NB_Coder_Frag** frags_map);

static void _nb_digest(const EVP_MD* md, struct NB_Bufs* bufs, struct NB_Buf* digest);
static bool _nb_digest_match(const EVP_MD* md, struct NB_Bufs* data, struct NB_Buf* digest);

static inline int
_nb_div_up(int n, int align)
{
    return (n + align - 1) / align;
}

static inline int
_nb_align_up(int n, int align)
{
    return _nb_div_up(n, align) * align;
}

void
nb_chunk_coder_init()
{
    cm256_init();
#ifndef WIN32
    // static inline unused functions from gf256.h
    (void)gf256_add;
    (void)gf256_mul;
    (void)gf256_div;
    (void)gf256_inv;
    (void)gf256_div_mem;
#endif
}

void
nb_chunk_init(struct NB_Coder_Chunk* chunk)
{
    chunk->digest_type[0] = 0;
    chunk->frag_digest_type[0] = 0;
    chunk->compress_type[0] = 0;
    chunk->cipher_type[0] = 0;
    chunk->parity_type[0] = 0;

    nb_bufs_init(&chunk->data);
    nb_bufs_init(&chunk->errors);
    nb_buf_init(&chunk->digest);
    nb_buf_init(&chunk->cipher_key);
    nb_buf_init(&chunk->cipher_iv);
    nb_buf_init(&chunk->cipher_auth_tag);

    chunk->frags = 0;
    chunk->coder = NB_Coder_Type::ENCODER;
    chunk->size = 0;
    chunk->compress_size = 0;
    chunk->data_frags = 1;
    chunk->parity_frags = 0;
    chunk->lrc_group = 0;
    chunk->lrc_frags = 0;
    chunk->frags_count = 0;
}

void
nb_chunk_free(struct NB_Coder_Chunk* chunk)
{
    nb_bufs_free(&chunk->data);
    nb_bufs_free(&chunk->errors);
    nb_buf_free(&chunk->digest);
    nb_buf_free(&chunk->cipher_key);
    nb_buf_free(&chunk->cipher_iv);
    nb_buf_free(&chunk->cipher_auth_tag);

    if (chunk->frags) {
        for (int i = 0; i < chunk->frags_count; ++i) {
            struct NB_Coder_Frag* f = chunk->frags + i;
            nb_frag_free(f);
        }
        nb_free(chunk->frags);
    }
}

void
nb_chunk_coder(struct NB_Coder_Chunk* chunk)
{
    if (chunk->errors.count) return;
    switch (chunk->coder) {
    case NB_Coder_Type::ENCODER:
        _nb_encode(chunk);
        break;
    case NB_Coder_Type::DECODER:
        _nb_decode(chunk);
        break;
    }
}

void
nb_chunk_error(struct NB_Coder_Chunk* chunk, const char* fmt, ...)
{
    va_list va;
    va_start(va, fmt);
    nb_bufs_push_vprintf(&chunk->errors, 256, fmt, va);
    va_end(va);
}

void
nb_frag_init(struct NB_Coder_Frag* f)
{
    nb_bufs_init(&f->block);
    nb_buf_init(&f->digest);
    f->data_index = -1;
    f->parity_index = -1;
    f->lrc_index = -1;
}

void
nb_frag_free(struct NB_Coder_Frag* f)
{
    nb_bufs_free(&f->block);
    nb_buf_free(&f->digest);
}

static void
_nb_encode(struct NB_Coder_Chunk* chunk)
{
    const EVP_MD* evp_md = 0;
    const EVP_MD* evp_md_frag = 0;
    const EVP_CIPHER* evp_cipher = 0;

    if (chunk->digest_type[0]) {
        evp_md = EVP_get_digestbyname(chunk->digest_type);
        if (!evp_md) {
            nb_chunk_error(chunk, "Chunk Encoder: unsupported digest type %s", chunk->digest_type);
            return;
        }
    }

    if (chunk->frag_digest_type[0]) {
        evp_md_frag = EVP_get_digestbyname(chunk->frag_digest_type);
        if (!evp_md_frag) {
            nb_chunk_error(
                chunk, "Chunk Encoder: unsupported frag digest type %s", chunk->frag_digest_type);
            return;
        }
    }

    if (chunk->cipher_type[0]) {
        evp_cipher = EVP_get_cipherbyname(chunk->cipher_type);
        if (!evp_cipher) {
            nb_chunk_error(chunk, "Chunk Encoder: unsupported cipher type %s", chunk->cipher_type);
            return;
        }
        const int cipher_block_size = EVP_CIPHER_block_size(evp_cipher);
        if (cipher_block_size != 1) {
            nb_chunk_error(
                chunk,
                "Chunk Encoder: unsupported cipher type %s with block size %i",
                chunk->cipher_type,
                cipher_block_size);
            return;
        }
    }

    if (chunk->data.len != chunk->size) {
        nb_chunk_error(
            chunk,
            "Chunk Encoder: chunk size mismatch %i data length %i",
            chunk->size,
            chunk->data.len);
        return;
    }

    if (evp_md) {
        _nb_digest(evp_md, &chunk->data, &chunk->digest);
    }

    if (chunk->compress_type[0]) {
        if (strcmp(chunk->compress_type, "snappy") == 0) {
            if (nb_snappy_compress(&chunk->data, &chunk->errors)) return;
        } else if (strcmp(chunk->compress_type, "zlib") == 0) {
            if (nb_zlib_compress(&chunk->data, &chunk->errors)) return;
        } else {
            nb_chunk_error(
                chunk, "Chunk Encoder: unsupported compress type %s", chunk->compress_type);
            return;
        }
        chunk->compress_size = chunk->data.len;
    }

    const int lrc_groups =
        (chunk->lrc_group == 0) ? 0 : (chunk->data_frags + chunk->parity_frags) / chunk->lrc_group;
    const int lrc_total_frags = lrc_groups * chunk->lrc_frags;
    const int total_frags = chunk->data_frags + chunk->parity_frags + lrc_total_frags;

    // align compressed_size up with zeros padding for data_frags
    const int padded_size = _nb_align_up(chunk->data.len, chunk->data_frags);
    assert(padded_size >= chunk->data.len);
    if (padded_size > chunk->data.len) {
        nb_bufs_push_zeros(&chunk->data, padded_size - chunk->data.len);
    }

    // init frags
    chunk->frag_size = chunk->data.len / chunk->data_frags;
    chunk->frags_count = total_frags;
    chunk->frags = nb_new_arr(total_frags, struct NB_Coder_Frag);
    for (int i = 0; i < chunk->frags_count; ++i) {
        struct NB_Coder_Frag* f = chunk->frags + i;
        nb_frag_init(f);
        if (i < chunk->data_frags) {
            f->data_index = i;
        } else if (i < chunk->data_frags + chunk->parity_frags) {
            f->parity_index = i - chunk->data_frags;
        } else {
            f->lrc_index = i - chunk->data_frags - chunk->parity_frags;
        }
    }

    if (evp_cipher) {
        _nb_encrypt(chunk, evp_cipher);
    } else {
        _nb_no_encrypt(chunk);
    }

    if (chunk->errors.count) return;

    if (chunk->parity_type[0]) {
        _nb_erasure(chunk);
    }

    if (chunk->errors.count) return;

    if (evp_md_frag) {
        for (int i = 0; i < chunk->frags_count; ++i) {
            struct NB_Coder_Frag* f = chunk->frags + i;
            _nb_digest(evp_md_frag, &f->block, &f->digest);
        }
    }
}

static void
_nb_encrypt(struct NB_Coder_Chunk* chunk, const EVP_CIPHER* evp_cipher)
{
    EVP_CIPHER_CTX *ctx = EVP_CIPHER_CTX_new();
    struct NB_Buf iv;
    int evp_ret = 0;

    // generate random cipher key
    // using iv of zeros since we generate random key per chunk
    const int key_len = EVP_CIPHER_key_length(evp_cipher);
    const int iv_len = EVP_CIPHER_iv_length(evp_cipher);

    if (chunk->cipher_key.len) {
        assert(chunk->cipher_key.len == key_len);
        if (chunk->cipher_iv.len) {
            // key provided iv provided => key=provided, iv=provided
            assert(chunk->cipher_iv.len == iv_len);
            nb_buf_init_shared(&iv, chunk->cipher_iv.data, chunk->cipher_iv.len);
        } else {
            // key provided iv not provided => key=provided, iv=random
            nb_buf_free(&chunk->cipher_iv);
            nb_buf_init_alloc(&chunk->cipher_iv, iv_len);
            RAND_bytes(chunk->cipher_iv.data, chunk->cipher_iv.len);
            nb_buf_init_shared(&iv, chunk->cipher_iv.data, chunk->cipher_iv.len);
        }
    } else {
        // key/iv not provided => key=random, iv=zeros
        nb_buf_init_zeros(&iv, iv_len);
        nb_buf_free(&chunk->cipher_iv);
        nb_buf_free(&chunk->cipher_key);
        nb_buf_init_alloc(&chunk->cipher_key, key_len);
        RAND_bytes(chunk->cipher_key.data, chunk->cipher_key.len);
    }

    StackCleaner cleaner([&] {
        EVP_CIPHER_CTX_free(ctx);
        nb_buf_free(&iv);
    });

    evp_ret = EVP_EncryptInit_ex(ctx, evp_cipher, NULL, chunk->cipher_key.data, iv.data);
    if (!evp_ret) {
        nb_chunk_error(chunk, "Chunk Encoder: cipher encrypt init failed %s", chunk->cipher_type);
        return;
    }

    // allocate blocks for all data frags
    for (int i = 0; i < chunk->data_frags; ++i) {
        struct NB_Coder_Frag* f = chunk->frags + i;
        nb_bufs_push_alloc(&f->block, chunk->frag_size);
    }

    int frag_pos = 0;
    struct NB_Coder_Frag* f = chunk->frags;

    for (int i = 0; i < chunk->data.count; ++i) {
        struct NB_Buf* b = nb_bufs_get(&chunk->data, i);

        for (int pos = 0; pos < b->len;) {

            if (f >= chunk->frags + chunk->data_frags) {
                assert(!"data frags exceeded");
                nb_chunk_error(chunk, "Chunk Encoder: data frags exceeded");
                return;
            }

            struct NB_Buf* fb = nb_bufs_get(&f->block, 0);
            assert(fb && fb->len == chunk->frag_size);

            if (frag_pos > fb->len) {
                assert(!"block len exceeded");
                nb_chunk_error(chunk, "Chunk Encoder: block len exceeded");
                return;
            }

            if (frag_pos == fb->len) {
                frag_pos = 0;
                f++;
                continue; // in order to recheck the conditions
            }

            const int needed = fb->len - frag_pos;
            const int avail = b->len - pos;
            const int len = avail < needed ? avail : needed;

            int out_len = 0;
            evp_ret = EVP_EncryptUpdate(ctx, fb->data + frag_pos, &out_len, b->data + pos, len);
            if (!evp_ret) {
                nb_chunk_error(
                    chunk, "Chunk Encoder: cipher encrypt update failed %s", chunk->cipher_type);
                return;
            }

            pos += len;
            frag_pos += out_len;
        }
    }

    if (f + 1 != chunk->frags + chunk->data_frags) {
        assert(!"data frags incomplete");
        nb_chunk_error(chunk, "Chunk Encoder: data frags incomplete");
        return;
    }

    if (frag_pos != chunk->frag_size) {
        assert(!"block len incomplete");
        nb_chunk_error(
            chunk,
            "Chunk Encoder: block len incomplete %i != %i %s",
            frag_pos,
            chunk->frag_size,
            chunk->cipher_type);
        return;
    }

    int out_len = 0;
    evp_ret = EVP_EncryptFinal_ex(ctx, 0, &out_len);
    if (!evp_ret) {
        nb_chunk_error(chunk, "Chunk Encoder: cipher encrypt final failed %s", chunk->cipher_type);
        return;
    }
    assert(!out_len);

    if (USE_GCM_AUTH_TAG && EVP_CIPHER_CTX_mode(ctx) == EVP_CIPH_GCM_MODE) {
        nb_buf_free(&chunk->cipher_auth_tag);
        nb_buf_init_alloc(&chunk->cipher_auth_tag, 16);
        evp_ret = EVP_CIPHER_CTX_ctrl(
            ctx, EVP_CTRL_GCM_GET_TAG, chunk->cipher_auth_tag.len, chunk->cipher_auth_tag.data);
        if (!evp_ret) {
            nb_chunk_error(
                chunk, "Chunk Encoder: cipher encrypt get tag failed %s", chunk->cipher_type);
            return;
        }
    }
}

static void
_nb_no_encrypt(struct NB_Coder_Chunk* chunk)
{
    struct NB_Coder_Frag* f = chunk->frags;

    for (int i = 0; i < chunk->data.count; ++i) {
        struct NB_Buf* b = nb_bufs_get(&chunk->data, i);

        for (int pos = 0; pos < b->len;) {

            if (f >= chunk->frags + chunk->data_frags) {
                assert(!"data frags exceeded");
                nb_chunk_error(chunk, "Chunk Encoder: data frags exceeded");
                return;
            }

            if (f->block.len > chunk->frag_size) {
                assert(!"block len exceeded");
                nb_chunk_error(chunk, "Chunk Encoder: block len exceeded");
                return;
            }

            if (f->block.len == chunk->frag_size) {
                f++;
                continue; // in order to recheck the conditions
            }

            const int needed = chunk->frag_size - f->block.len;
            const int avail = b->len - pos;
            const int len = avail < needed ? avail : needed;

            nb_bufs_push_shared(&f->block, b->data + pos, len);
            pos += len;
        }
    }

    if (f + 1 != chunk->frags + chunk->data_frags) {
        assert(!"data frags incomplete");
        nb_chunk_error(chunk, "Chunk Encoder: data frags incomplete");
        return;
    }

    if (f->block.len != chunk->frag_size) {
        assert(!"block len incomplete");
        nb_chunk_error(
            chunk,
            "Chunk Encoder: block len incomplete %i != %i %s",
            f->block.len,
            chunk->frag_size,
            chunk->cipher_type);
        return;
    }
}

static void
_nb_erasure(struct NB_Coder_Chunk* chunk)
{
    struct NB_Buf parity_buf;

    NB_Parity_Type parity_type;
    if (strcmp(chunk->parity_type, "isa-c1") == 0) {
        parity_type = NB_Parity_Type::C1;
    } else if (strcmp(chunk->parity_type, "isa-rs") == 0) {
        parity_type = NB_Parity_Type::RS;
    } else if (strcmp(chunk->parity_type, "cm256") == 0) {
        parity_type = NB_Parity_Type::CM;
    } else {
        parity_type = NB_Parity_Type::NONE;
    }

    if (parity_type == NB_Parity_Type::NONE || chunk->parity_frags <= 0) return;

    if (chunk->data_frags > MAX_DATA_FRAGS || chunk->parity_frags > MAX_PARITY_FRAGS) {
        nb_chunk_error(
            chunk,
            "Chunk Encoder: erasure code above hardcoded limits"
            " data_frags %i"
            " MAX_DATA_FRAGS %i"
            " parity_frags %i"
            " MAX_PARITY_FRAGS %i",
            chunk->data_frags,
            MAX_DATA_FRAGS,
            chunk->parity_frags,
            MAX_PARITY_FRAGS);
        return;
    }

    // allocate a single buffer for all the parity blocks
    // the first parity fragment will become the owner of the entire allocation
    // and the rest will share it
    nb_buf_init_alloc(&parity_buf, chunk->parity_frags * chunk->frag_size);
    for (int i = 0; i < chunk->parity_frags; ++i) {
        struct NB_Coder_Frag* f = chunk->frags + chunk->data_frags + i;
        if (i == 0) {
            nb_bufs_push_owned(&f->block, parity_buf.data, chunk->frag_size);
        } else {
            nb_bufs_push_shared(
                &f->block, parity_buf.data + (i * chunk->frag_size), chunk->frag_size);
        }
    }

    if (parity_type == NB_Parity_Type::C1 || parity_type == NB_Parity_Type::RS) {
        uint8_t ec_matrix_encode[MAX_MATRIX_SIZE];
        uint8_t ec_table[MAX_MATRIX_SIZE * 32];
        uint8_t* ec_blocks[MAX_TOTAL_FRAGS];
        const int k = chunk->data_frags;
        const int m = chunk->data_frags + chunk->parity_frags;
        for (int i = 0; i < m; ++i) {
            struct NB_Coder_Frag* f = chunk->frags + i;
            ec_blocks[i] = nb_bufs_merge(&f->block, 0);
        }
        if (parity_type == NB_Parity_Type::C1) {
            gf_gen_cauchy1_matrix(ec_matrix_encode, m, k);
        } else {
            gf_gen_rs_matrix(ec_matrix_encode, m, k);
        }
        ec_init_tables(k, m - k, &ec_matrix_encode[k * k], ec_table);
        ec_encode_data(chunk->frag_size, k, m - k, ec_table, ec_blocks, &ec_blocks[k]);
    } else if (parity_type == NB_Parity_Type::CM) {
        cm256_encoder_params cm_params;
        cm256_block cm_blocks[MAX_DATA_FRAGS];
        cm_params.BlockBytes = chunk->frag_size;
        cm_params.OriginalCount = chunk->data_frags;
        cm_params.RecoveryCount = chunk->parity_frags;
        for (int i = 0; i < chunk->data_frags; ++i) {
            struct NB_Coder_Frag* f = chunk->frags + i;
            cm_blocks[i].Index = i;
            cm_blocks[i].Block = nb_bufs_merge(&f->block, 0);
        }
        int encode_err = cm256_encode(cm_params, cm_blocks, parity_buf.data);
        if (encode_err) {
            nb_chunk_error(
                chunk,
                "Chunk Encoder: erasure encode failed %i"
                " frags_count %i"
                " frag_size %i"
                " data_frags %i"
                " parity_frags %i",
                encode_err,
                chunk->frags_count,
                chunk->frag_size,
                chunk->data_frags,
                chunk->parity_frags);
            return;
        }
    }
}

static void
_nb_decode(struct NB_Coder_Chunk* chunk)
{
    const EVP_MD* evp_md = 0;
    const EVP_MD* evp_md_frag = 0;
    const EVP_CIPHER* evp_cipher = 0;
    struct NB_Coder_Frag** frags_map = 0;

    StackCleaner cleaner([&] {
        if (frags_map) nb_free(frags_map);
    });

    if (chunk->digest_type[0]) {
        evp_md = EVP_get_digestbyname(chunk->digest_type);
        if (!evp_md) {
            nb_chunk_error(chunk, "Chunk Decoder: unsupported digest type %s", chunk->digest_type);
            return;
        }
    }

    if (chunk->frag_digest_type[0]) {
        evp_md_frag = EVP_get_digestbyname(chunk->frag_digest_type);
        if (!evp_md_frag) {
            nb_chunk_error(
                chunk, "Chunk Decoder: unsupported frag digest type %s", chunk->frag_digest_type);
            return;
        }
    }

    if (chunk->cipher_type[0]) {
        evp_cipher = EVP_get_cipherbyname(chunk->cipher_type);
        if (!evp_cipher) {
            nb_chunk_error(chunk, "Chunk Decoder: unsupported cipher type %s", chunk->cipher_type);
            return;
        }
        const int cipher_block_size = EVP_CIPHER_block_size(evp_cipher);
        if (cipher_block_size != 1) {
            nb_chunk_error(
                chunk,
                "Chunk Decoder: unsupported cipher type %s with block size %i",
                chunk->cipher_type,
                cipher_block_size);
            return;
        }
    }

    if (chunk->frags_count < chunk->data_frags) {
        nb_chunk_error(chunk, "Chunk Decoder: missing data frags");
        return;
    }

    const int lrc_groups =
        (chunk->lrc_group == 0) ? 0 : (chunk->data_frags + chunk->parity_frags) / chunk->lrc_group;
    const int lrc_total_frags = lrc_groups * chunk->lrc_frags;
    const int total_frags = chunk->data_frags + chunk->parity_frags + lrc_total_frags;
    const int decrypted_size = chunk->compress_size > 0 ? chunk->compress_size : chunk->size;
    const int padded_size = _nb_align_up(decrypted_size, chunk->data_frags);

    if (chunk->frag_size != padded_size / chunk->data_frags) {
        nb_chunk_error(chunk, "Chunk Decoder: mismatch frag size");
        return;
    }

    frags_map = nb_new_arr(total_frags, struct NB_Coder_Frag*);

    _nb_derasure(chunk, frags_map, total_frags);

    if (chunk->errors.count) return;

    if (evp_cipher) {
        _nb_decrypt(chunk, frags_map, evp_cipher);
    } else {
        _nb_no_decrypt(chunk, frags_map);
    }

    if (chunk->errors.count) return;

    if (chunk->data.len < decrypted_size || chunk->data.len > padded_size) {
        nb_chunk_error(
            chunk,
            "Chunk Decoder: size mismatch %i data length %i",
            decrypted_size,
            chunk->data.len);
        return;
    }

    nb_bufs_truncate(&chunk->data, decrypted_size);

    if (chunk->compress_type[0]) {
        if (strcmp(chunk->compress_type, "snappy") == 0) {
            nb_snappy_uncompress(&chunk->data, &chunk->errors);
        } else if (strcmp(chunk->compress_type, "zlib") == 0) {
            nb_zlib_uncompress(&chunk->data, chunk->size, &chunk->errors);
        } else {
            nb_chunk_error(
                chunk, "Chunk Decoder: unsupported compress type %s", chunk->compress_type);
        }
        if (chunk->errors.count) return;
    }

    // check that chunk size matches the size used when encoding
    if (chunk->data.len != chunk->size) {
        nb_chunk_error(
            chunk, "Chunk Decoder: size mismatch %i data length %i", chunk->size, chunk->data.len);
        return;
    }

    // check that chunk data digest matches the digest computed during encoding
    if (evp_md) {
        if (!_nb_digest_match(evp_md, &chunk->data, &chunk->digest)) {
            nb_chunk_error(chunk, "Chunk Decoder: chunk digest mismatch %s", chunk->digest_type);
        }
    }
}

static void
_nb_ec_select_available_fragments(
    struct NB_Coder_Frag** frags_map,
    int k,
    int m,
    uint8_t* a,
    uint8_t* b,
    uint8_t* out_index,
    int* p_out_len,
    uint8_t** in_bufs)
{
    int out_len = 0;
    for (int i = 0, r = 0; i < k; ++i, ++r) {
        assert(r >= 0 && r < m);
        while (!frags_map[r]) {
            if (r < k) {
                // decoding only data fragments
                out_index[out_len] = r;
                ++out_len;
            }
            ++r;
            assert(r >= 0 && r < m);
        }
        in_bufs[i] = nb_bufs_merge(&frags_map[r]->block, 0);
        memcpy(&b[k * i], &a[k * r], k);
    }
    *p_out_len = out_len;
}

static void
_nb_ec_update_decoded_fragments(
    struct NB_Coder_Frag** frags_map, int k, int m, int out_len, uint8_t** out_bufs, int frag_size)
{
    // replace parity fragments with the decoded data fragments
    for (int i = 0, j = 0, r = k; i < out_len; ++i, ++j, ++r) {
        assert(j >= 0 && j < k);
        while (frags_map[j]) {
            ++j;
            assert(j >= 0 && j < k);
        }
        assert(r >= k && r < m);
        while (!frags_map[r]) {
            ++r;
            assert(r >= k && r < m);
        }
        struct NB_Coder_Frag* f = frags_map[r];
        f->data_index = j;
        nb_bufs_free(&f->block);
        nb_bufs_init(&f->block);
        nb_bufs_push_owned(&f->block, out_bufs[i], frag_size);
        frags_map[r] = 0;
        frags_map[j] = f;
    }
}

static void
_nb_derasure(struct NB_Coder_Chunk* chunk, struct NB_Coder_Frag** frags_map, int total_frags)
{
    const EVP_MD* evp_md_frag = 0;
    int num_avail_data_frags = 0;
    int num_avail_parity_frags = 0;

    NB_Parity_Type parity_type;
    if (strcmp(chunk->parity_type, "isa-c1") == 0) {
        parity_type = NB_Parity_Type::C1;
    } else if (strcmp(chunk->parity_type, "isa-rs") == 0) {
        parity_type = NB_Parity_Type::RS;
    } else if (strcmp(chunk->parity_type, "cm256") == 0) {
        parity_type = NB_Parity_Type::CM;
    } else {
        parity_type = NB_Parity_Type::NONE;
    }

    if (chunk->frag_digest_type[0]) {
        evp_md_frag = EVP_get_digestbyname(chunk->frag_digest_type);
    }

    for (int i = 0; i < total_frags; ++i) {
        frags_map[i] = 0;
    }

    for (int i = 0; i < chunk->frags_count; ++i) {
        struct NB_Coder_Frag* f = chunk->frags + i;
        int index = -1;
        if (f->data_index >= 0 && f->data_index < chunk->data_frags) {
            index = f->data_index;
        } else if (f->parity_index >= 0 && f->parity_index < chunk->parity_frags) {
            index = chunk->data_frags + f->parity_index;
        } else if (f->lrc_index >= 0 && f->lrc_index < total_frags - chunk->data_frags - chunk->parity_frags) {
            continue; // lrc not yet applicable
        } else {
            continue; // invalid chunk index
        }
        if (f->block.len != chunk->frag_size) {
            if (f->block.len) {
                printf(
                    "CODER MISMATCHING BLOCK SIZE i=%i index=%i block_size=%i frag_size=%i\n",
                    i,
                    index,
                    f->block.len,
                    chunk->frag_size);
            }
            continue; // mismatching block size
        }
        if (frags_map[index]) {
            continue; // duplicate frag
        }
        if (evp_md_frag) {
            if (!_nb_digest_match(evp_md_frag, &f->block, &f->digest)) {
                continue; // mismatching block digest
            }
        }
        frags_map[index] = f;
        if (index < chunk->data_frags) {
            num_avail_data_frags++;
        } else {
            num_avail_parity_frags++;
        }
    }

    assert(num_avail_data_frags <= chunk->data_frags);

    if (num_avail_data_frags < chunk->data_frags) {

        if (chunk->parity_frags <= 0) {
            nb_chunk_error(chunk, "Chunk Decoder: missing data frags and no parity");
            return;
        }
        if (num_avail_data_frags + num_avail_parity_frags < chunk->data_frags) {
            nb_chunk_error(chunk, "Chunk Decoder: missing data frags and not enough parity");
            return;
        }

        if (parity_type == NB_Parity_Type::C1 || parity_type == NB_Parity_Type::RS) {
            const int k = chunk->data_frags;
            const int m = chunk->data_frags + chunk->parity_frags;
            uint8_t ec_table[MAX_MATRIX_SIZE * 32];
            uint8_t a[MAX_MATRIX_SIZE];
            uint8_t b[MAX_MATRIX_SIZE];
            uint8_t* in_bufs[MAX_DATA_FRAGS];
            uint8_t* out_bufs[MAX_PARITY_FRAGS];
            uint8_t out_index[MAX_PARITY_FRAGS];
            int out_len = 0;
            // calculate the decode matrix:
            if (parity_type == NB_Parity_Type::C1) {
                gf_gen_cauchy1_matrix(a, m, k);
            } else {
                gf_gen_rs_matrix(a, m, k);
            }
            _nb_ec_select_available_fragments(frags_map, k, m, a, b, out_index, &out_len, in_bufs);
            assert(out_len == chunk->data_frags - num_avail_data_frags);
            if (gf_invert_matrix(b, a, k) < 0) {
                nb_chunk_error(
                    chunk,
                    "Chunk Decoder: erasure decode invert failed"
                    " data_frags %i/%i"
                    " parity_frags %i/%i",
                    num_avail_data_frags,
                    chunk->data_frags,
                    num_avail_parity_frags,
                    chunk->parity_frags);
                return;
            }
            // select rows of missing data fragments
            for (int i = 0; i < out_len; ++i) {
                memcpy(&b[k * i], &a[k * out_index[i]], k);
                out_bufs[i] = nb_new_mem(chunk->frag_size);
            }
            ec_init_tables(k, out_len, b, ec_table);
            ec_encode_data(chunk->frag_size, k, out_len, ec_table, in_bufs, out_bufs);
            _nb_ec_update_decoded_fragments(frags_map, k, m, out_len, out_bufs, chunk->frag_size);

        } else if (parity_type == NB_Parity_Type::CM) {
            cm256_encoder_params cm_params;
            cm_params.BlockBytes = chunk->frag_size;
            cm_params.OriginalCount = chunk->data_frags;
            cm_params.RecoveryCount = chunk->parity_frags;
            cm256_block cm_blocks[MAX_DATA_FRAGS];
            int next_parity = chunk->data_frags;
            for (int i = 0; i < chunk->data_frags; ++i) {
                while (!frags_map[i]) {
                    assert(next_parity < chunk->data_frags + chunk->parity_frags);
                    frags_map[i] = frags_map[next_parity];
                    frags_map[next_parity] = 0;
                    ++next_parity;
                }
                if (frags_map[i]->data_index >= 0) {
                    cm_blocks[i].Index = frags_map[i]->data_index;
                } else {
                    cm_blocks[i].Index = chunk->data_frags + frags_map[i]->parity_index;
                }
                cm_blocks[i].Block = nb_bufs_merge(&frags_map[i]->block, 0);
            }
            int decode_err = cm256_decode(cm_params, cm_blocks);
            if (decode_err) {
                nb_chunk_error(
                    chunk,
                    "Chunk Decoder: erasure decode failed %i"
                    " data_frags %i/%i"
                    " parity_frags %i/%i",
                    decode_err,
                    num_avail_data_frags,
                    chunk->data_frags,
                    num_avail_parity_frags,
                    chunk->parity_frags);
                return;
            }

        } else {
            nb_chunk_error(
                chunk,
                "Chunk Decoder: erasure decode bad type %s"
                " data_frags %i/%i"
                " parity_frags %i/%i",
                chunk->parity_type,
                num_avail_data_frags,
                chunk->data_frags,
                num_avail_parity_frags,
                chunk->parity_frags);
            return;
        }

        // we could test the digest of re-computed fragments here
        // but it seems anal because the chunk digest should cover it
    }
}

static void
_nb_decrypt(
    struct NB_Coder_Chunk* chunk, struct NB_Coder_Frag** frags_map, const EVP_CIPHER* evp_cipher)
{
    EVP_CIPHER_CTX *ctx = EVP_CIPHER_CTX_new();
    struct NB_Buf iv;
    int evp_ret = 0;
    bool skip_auth = false;

    // const int key_len = EVP_CIPHER_key_length(evp_cipher);
    const int iv_len = EVP_CIPHER_iv_length(evp_cipher);
    const int decrypted_size = chunk->compress_size > 0 ? chunk->compress_size : chunk->size;
    const int padded_size = _nb_align_up(decrypted_size, chunk->data_frags);

    if (chunk->cipher_iv.len) {
        nb_buf_init_shared(&iv, chunk->cipher_iv.data, chunk->cipher_iv.len);
    } else {
        // using iv of zeros since we generate random key per chunk
        nb_buf_init_zeros(&iv, iv_len);
    }

    StackCleaner cleaner([&] {
        EVP_CIPHER_CTX_free(ctx);
        nb_buf_free(&iv);
    });

    evp_ret = EVP_DecryptInit_ex(ctx, evp_cipher, NULL, chunk->cipher_key.data, iv.data);
    if (!evp_ret) {
        nb_chunk_error(chunk, "Chunk Decoder: cipher decrypt init failed %s", chunk->cipher_type);
        return;
    }

    if (EVP_CIPHER_CTX_mode(ctx) == EVP_CIPH_GCM_MODE) {
        if (USE_GCM_AUTH_TAG && chunk->cipher_auth_tag.len) {
            evp_ret = EVP_CIPHER_CTX_ctrl(
                ctx,
                EVP_CTRL_GCM_SET_TAG,
                chunk->cipher_auth_tag.len,
                chunk->cipher_auth_tag.data);
            if (!evp_ret) {
                nb_chunk_error(
                    chunk, "Chunk Decoder: cipher decrypt set tag failed %s", chunk->cipher_type);
                return;
            }
        } else {
            skip_auth = true;
        }
    }

    int pos = 0;
    struct NB_Buf* b = nb_bufs_push_alloc(&chunk->data, padded_size);

    for (int i = 0; i < chunk->data_frags; ++i) {
        struct NB_Coder_Frag* f = frags_map[i];
        for (int j = 0; j < f->block.count; ++j) {
            struct NB_Buf* fb = nb_bufs_get(&f->block, j);

            int out_len = 0;
            evp_ret = EVP_DecryptUpdate(ctx, b->data + pos, &out_len, fb->data, fb->len);
            if (!evp_ret) {
                nb_chunk_error(
                    chunk, "Chunk Decoder: cipher decrypt update failed %s", chunk->cipher_type);
                return;
            }
            pos += out_len;
        }
    }

    int out_len = 0;
    evp_ret = EVP_DecryptFinal_ex(ctx, 0, &out_len);
    if (!evp_ret && !skip_auth) {
        nb_chunk_error(chunk, "Chunk Decoder: cipher decrypt final failed %s", chunk->cipher_type);
        return;
    }
    assert(!out_len);
}

static void
_nb_no_decrypt(struct NB_Coder_Chunk* chunk, struct NB_Coder_Frag** frags_map)
{
    for (int i = 0; i < chunk->data_frags; ++i) {
        struct NB_Coder_Frag* f = frags_map[i];
        for (int j = 0; j < f->block.count; ++j) {
            struct NB_Buf* b = nb_bufs_get(&f->block, j);
            nb_bufs_push_shared(&chunk->data, b->data, b->len);
        }
    }
}

static void
_nb_digest(const EVP_MD* md, struct NB_Bufs* data, struct NB_Buf* digest)
{
    EVP_MD_CTX *ctx_md = EVP_MD_CTX_new();
    EVP_DigestInit_ex(ctx_md, md, NULL);

    struct NB_Buf* b = nb_bufs_get(data, 0);
    for (int i = 0; i < data->count; ++i, ++b) {
        EVP_DigestUpdate(ctx_md, b->data, b->len);
    }

    uint32_t digest_len = EVP_MD_size(md);
    nb_buf_free(digest);
    nb_buf_init_alloc(digest, digest_len);
    EVP_DigestFinal_ex(ctx_md, digest->data, &digest_len);
    assert((int)digest_len == digest->len);

    EVP_MD_CTX_free(ctx_md);
}

static bool
_nb_digest_match(const EVP_MD* md, struct NB_Bufs* data, struct NB_Buf* digest)
{
    struct NB_Buf computed_digest;
    nb_buf_init(&computed_digest);
    _nb_digest(md, data, &computed_digest);

    bool match =
        (computed_digest.len == digest->len &&
         memcmp(computed_digest.data, digest->data, digest->len) == 0);

    nb_buf_free(&computed_digest);

    // if (!match) {
    // struct NB_Buf expected_hex;
    // struct NB_Buf computed_hex;
    // nb_buf_init_hex_str(&computed_hex, &computed_digest);
    // nb_buf_init_hex_str(&expected_hex, digest);
    // printf(
    //     "digest_type %s computed %s expected %s\n",
    //     digest_type,
    //     (char *)computed_hex.data,
    //     (char *)expected_hex.data);
    // nb_buf_free(&computed_hex);
    // nb_buf_free(&expected_hex);
    // }

    return match;
}
}
