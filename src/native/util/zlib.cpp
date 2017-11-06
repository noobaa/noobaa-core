/* Copyright (C) 2016 NooBaa */
#include "zlib.h"

#include <assert.h>
#include <stdbool.h>
#include <stdio.h>

#include <zlib.h>

#include "../util/common.h"

namespace noobaa
{

DBG_INIT(0);

int
nb_zlib_compress(struct NB_Bufs* bufs, struct NB_Bufs* errors)
{
    int z_res;
    z_stream strm;
    struct NB_Bufs out;

    nb_bufs_init(&out);

    strm.zalloc = 0;
    strm.zfree = 0;
    strm.opaque = 0;
    strm.next_out = 0;
    strm.avail_out = 0;
    strm.next_in = 0;
    strm.avail_in = 0;

    StackCleaner cleaner([&] {
        nb_bufs_free(&out);
        deflateEnd(&strm);
    });

    z_res = deflateInit(&strm, Z_BEST_SPEED);
    if (z_res != Z_OK) {
        nb_bufs_push_printf(
            errors, 256, "nb_zlib_compress: deflateInit() error %i %s", z_res, strm.msg);
        return -1;
    }

    for (int i = 0; i < bufs->count; ++i) {
        struct NB_Buf* b = nb_bufs_get(bufs, i);
        strm.next_in = b->data;
        strm.avail_in = b->len;
        while (strm.avail_in) {
            if (!strm.avail_out) {
                struct NB_Buf* o = nb_bufs_push_alloc(&out, NB_BUF_PAGE_SIZE);
                strm.next_out = o->data;
                strm.avail_out = o->len;
            }
            z_res = deflate(&strm, Z_NO_FLUSH);
            switch (z_res) {
            case Z_OK:
            case Z_STREAM_END:
            case Z_BUF_ERROR:
                break;
            default:
                nb_bufs_push_printf(
                    errors,
                    256,
                    "nb_zlib_compress: deflate(Z_NO_FLUSH) error %i %s avail_in %i avail_out %i",
                    z_res,
                    strm.msg,
                    strm.avail_in,
                    strm.avail_out);
                return -1;
            }
        }
    }

    bool end = false;
    while (!end) {
        z_res = deflate(&strm, Z_FINISH);
        switch (z_res) {
        case Z_STREAM_END:
            end = true;
            break;
        case Z_OK:
            break; // need to allocate on Z_OK too ???
        case Z_BUF_ERROR:
            if (!strm.avail_out) {
                struct NB_Buf* o = nb_bufs_push_alloc(&out, NB_BUF_PAGE_SIZE);
                strm.next_out = o->data;
                strm.avail_out = o->len;
            }
            break;
        default:
            nb_bufs_push_printf(
                errors, 256, "nb_zlib_compress: deflate(Z_FINISH) error %i %s", z_res, strm.msg);
            return -1;
        }
    }

    assert(out.len >= (int)strm.total_out);
    nb_bufs_truncate(&out, strm.total_out);
    out.len = strm.total_out;

    z_res = deflateEnd(&strm);
    if (z_res != Z_OK) {
        nb_bufs_push_printf(
            errors, 256, "nb_zlib_compress: deflateEnd() error %i %s", z_res, strm.msg);
        return -1;
    }

    DBG1("nb_zlib_compress: " << DVAL(bufs->len) << DVAL(bufs->count) << DVAL(out.len) << DVAL(out.count));

    nb_bufs_free(bufs);
    *bufs = out;
    nb_bufs_init(&out);
    return 0;
}

int
nb_zlib_uncompress(struct NB_Bufs* bufs, int uncompressed_len, struct NB_Bufs* errors)
{
    int z_res;
    z_stream strm;
    struct NB_Bufs out;

    nb_bufs_init(&out);

    strm.zalloc = 0;
    strm.zfree = 0;
    strm.opaque = 0;
    strm.next_out = 0;
    strm.avail_out = 0;
    strm.next_in = 0;
    strm.avail_in = 0;

    StackCleaner cleaner([&] {
        nb_bufs_free(&out);
        inflateEnd(&strm);
    });

    z_res = inflateInit(&strm);
    if (z_res != Z_OK) {
        nb_bufs_push_printf(
            errors, 256, "nb_zlib_uncompress: inflateInit() error %i %s", z_res, strm.msg);
        return -1;
    }

    for (int i = 0; i < bufs->count; ++i) {
        struct NB_Buf* b = nb_bufs_get(bufs, i);
        strm.next_in = b->data;
        strm.avail_in = b->len;
        while (strm.avail_in) {
            if (!strm.avail_out) {
                struct NB_Buf* o = nb_bufs_push_alloc(&out, NB_BUF_PAGE_SIZE);
                strm.next_out = o->data;
                strm.avail_out = o->len;
            }
            z_res = inflate(&strm, Z_NO_FLUSH);
            switch (z_res) {
            case Z_OK:
            case Z_STREAM_END:
            case Z_BUF_ERROR:
                break;
            default:
                nb_bufs_push_printf(
                    errors,
                    256,
                    "nb_zlib_compress: inflate(Z_NO_FLUSH) error %i %s",
                    z_res,
                    strm.msg);
                return -1;
            }
        }
    }

    bool end = false;
    while (!end) {
        z_res = inflate(&strm, Z_FINISH);
        switch (z_res) {
        case Z_STREAM_END:
            end = true;
            break;
        case Z_OK:
            break; // need to allocate on Z_OK too ???
        case Z_BUF_ERROR:
            if (!strm.avail_out) {
                struct NB_Buf* o = nb_bufs_push_alloc(&out, NB_BUF_PAGE_SIZE);
                strm.next_out = o->data;
                strm.avail_out = o->len;
            }
            break;
        default:
            nb_bufs_push_printf(
                errors, 256, "nb_zlib_compress: inflate(Z_FINISH) error %i %s", z_res, strm.msg);
            return -1;
        }
    }

    assert(out.len >= (int)strm.total_out);
    nb_bufs_truncate(&out, strm.total_out);
    out.len = strm.total_out;

    z_res = inflateEnd(&strm);
    if (z_res != Z_OK) {
        nb_bufs_push_printf(
            errors, 256, "nb_zlib_compress: inflateEnd() error %i %s", z_res, strm.msg);
        return -1;
    }

    DBG1("nb_zlib_uncompress: " << DVAL(bufs->len) << DVAL(bufs->count) << DVAL(out.len) << DVAL(out.count));

    nb_bufs_free(bufs);
    *bufs = out;
    nb_bufs_init(&out);
    return 0;
}
}
