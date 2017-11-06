/* Copyright (C) 2016 NooBaa */
#include "snappy.h"
#include "../third_party/snappy/snappy-sinksource.h"
#include "../third_party/snappy/snappy.h"
#include <assert.h>

namespace noobaa
{

class BufsSource : public snappy::Source
{
public:
    struct NB_Bufs* bufs;
    int index;
    int offset;
    int pos;

    BufsSource(struct NB_Bufs* input)
        : bufs(input), index(0), offset(0), pos(0) {}
    virtual ~BufsSource() {}

    virtual size_t
    Available() const
    {
        assert(bufs->len >= pos);
        return bufs->len - pos;
    }

    virtual const char*
    Peek(size_t* len)
    {
        struct NB_Buf* b = nb_bufs_get(bufs, index);
        if (b) {
            assert(b->len >= offset);
            *len = b->len - offset;
            return (const char*)b->data + offset;
        } else {
            *len = 0;
            return 0;
        }
    }

    virtual void
    Skip(size_t n)
    {
        while (n) {
            struct NB_Buf* b = nb_bufs_get(bufs, index);
            assert(b);
            assert(b->len >= offset);
            int avail = b->len - offset;
            if (avail <= (int)n) {
                index++;
                offset = 0;
                pos += avail;
                n -= avail;
            } else {
                offset += n;
                pos += n;
                n = 0;
            }
        }
    }
};

class BufsSink : public snappy::Sink
{
public:
    struct NB_Bufs* bufs;
    struct NB_Buf append;

    BufsSink(struct NB_Bufs* output)
        : bufs(output) { nb_buf_init(&append); }
    virtual ~BufsSink() { nb_buf_free(&append); }

    virtual char*
    GetAppendBuffer(size_t len, char* scratch)
    {
        nb_buf_free(&append);
        return (char*)nb_buf_init_alloc(&append, len);
    }

    // Append "bytes[0,n-1]" to this.
    virtual void
    Append(const char* bytes, size_t len)
    {
        if (append.data == (uint8_t*)bytes) {
            assert(append.len >= (int)len);
            append.len = len;
            nb_bufs_push(bufs, &append);
            nb_buf_init(&append);
        } else {
            nb_buf_free(&append);
            nb_buf_init(&append);
            nb_bufs_push_copy(bufs, (uint8_t*)bytes, len);
        }
    }

    virtual char*
    GetAppendBufferVariable(
        size_t min_size,
        size_t desired_size_hint,
        char* scratch,
        size_t scratch_size,
        size_t* allocated_size)
    {
        *allocated_size = desired_size_hint;
        if (*allocated_size < min_size) {
            *allocated_size = min_size;
        }
        nb_buf_free(&append);
        return (char*)nb_buf_init_alloc(&append, *allocated_size);
    }

    virtual void
    AppendAndTakeOwnership(
        char* bytes, size_t len, void (*deleter)(void*, const char*, size_t), void* deleter_arg)
    {
        if (append.data == (uint8_t*)bytes) {
            assert(append.len >= (int)len);
            append.len = len;
            nb_bufs_push(bufs, &append);
            nb_buf_init(&append);
        } else {
            nb_buf_free(&append);
            nb_buf_init_owned(&append, (uint8_t*)bytes, len);
            append.deleter = deleter;
            append.deleter_arg = deleter_arg;
            nb_bufs_push(bufs, &append);
            nb_buf_init(&append);
        }
    }
};

#define DBG 0

int
nb_snappy_compress(struct NB_Bufs* bufs, struct NB_Bufs* errors)
{
    struct NB_Bufs out;
    nb_bufs_init(&out);

    BufsSource source(bufs);
    BufsSink sink(&out);

    int compressed_len = (int)snappy::Compress(&source, &sink);

#if DBG
    printf(
        "nb_snappy_compress: input %i [#%i] output %i [#%i]\n",
        bufs->len,
        bufs->count,
        out.len,
        out.count);
#endif

    if (out.len != compressed_len) {
        nb_bufs_push_printf(
            errors,
            256,
            "nb_snappy_compress: mismatch compressed len %i from output %i",
            compressed_len,
            out.len);
        nb_bufs_free(&out);
        return -1;
    }

    nb_bufs_free(bufs);
    *bufs = out;
    return 0;
}

int
nb_snappy_uncompress(struct NB_Bufs* bufs, struct NB_Bufs* errors)
{
    struct NB_Bufs out;
    nb_bufs_init(&out);

    BufsSource source(bufs);
    BufsSink sink(&out);

    bool snappy_uncompress_ok = snappy::Uncompress(&source, &sink);

    if (!snappy_uncompress_ok) {
        nb_bufs_push_printf(errors, 256, "nb_snappy_uncompress: invalid data");
        nb_bufs_free(&out);
        return -1;
    }

#if DBG
    printf(
        "nb_snappy_uncompress: input %i [#%i] output %i [#%i]\n",
        bufs->len,
        bufs->count,
        out.len,
        out.count);
#endif

    nb_bufs_free(bufs);
    *bufs = out;
    return 0;
}
}
