/* Copyright (C) 2016 NooBaa */
#include "struct_buf.h"
#include <stdio.h>

namespace noobaa
{

static uint8_t _from_hex(char c);

void
nb_buf_init(struct NB_Buf* buf)
{
    buf->data = 0;
    buf->len = 0;
    buf->deleter = 0;
    buf->deleter_arg = 0;
}

void
nb_buf_init_shared(struct NB_Buf* buf, uint8_t* data, int len)
{
    buf->data = data;
    buf->len = len;
    buf->deleter = 0;
    buf->deleter_arg = 0;
}

void
nb_buf_init_owned(struct NB_Buf* buf, uint8_t* data, int len)
{
    buf->data = data;
    buf->len = len;
    buf->deleter = nb_buf_default_deleter;
    buf->deleter_arg = 0;
}

void
nb_buf_init_copy(struct NB_Buf* buf, uint8_t* data, int len)
{
    nb_buf_init_alloc(buf, len);
    memcpy(buf->data, data, len);
}

uint8_t*
nb_buf_init_alloc(struct NB_Buf* buf, int len)
{
    uint8_t* data = nb_new_mem(len);
    buf->data = data;
    buf->len = len;
    buf->deleter = nb_buf_default_deleter;
    buf->deleter_arg = 0;
    return data;
}

uint8_t* g_zero_buf = 0;
const int g_zero_buf_len = 128 * 1024;

void
nb_buf_init_zeros(struct NB_Buf* buf, int len)
{
    if (len <= g_zero_buf_len) {
        if (!g_zero_buf) {
            g_zero_buf = nb_new_mem(g_zero_buf_len);
            memset(g_zero_buf, 0, g_zero_buf_len);
        }
        buf->data = g_zero_buf;
        buf->len = len;
        buf->deleter = 0;
        buf->deleter_arg = 0;
    } else {
        nb_buf_init_alloc(buf, len);
        memset(buf->data, 0, len);
    }
}

void
nb_buf_init_hex_str(struct NB_Buf* buf, struct NB_Buf* source)
{
    nb_buf_init_alloc(buf, 2 * source->len + 1);
    const char* HEX = "0123456789abcdef";
    for (int i = 0; i < source->len; ++i) {
        buf->data[2 * i] = HEX[source->data[i] >> 4];
        buf->data[2 * i + 1] = HEX[source->data[i] & 0xf];
    }
    buf->data[2 * source->len] = 0;
}

void
nb_buf_init_from_hex(struct NB_Buf* buf, struct NB_Buf* source_hex)
{
    nb_buf_init_alloc(buf, source_hex->len / 2);
    for (int i = 0; i < buf->len; ++i) {
        buf->data[i] =
            _from_hex(source_hex->data[2 * i] << 4) | _from_hex(source_hex->data[2 * i + 1]);
    }
}

void
nb_buf_free(struct NB_Buf* buf)
{
    if (buf->deleter) {
        buf->deleter(buf->deleter_arg, (const char*)buf->data, buf->len);
    }
}

void
nb_buf_default_deleter(void* arg, const char* data, size_t len)
{
    if (data) {
        nb_free((void*)data);
    }
}

void
nb_bufs_init(struct NB_Bufs* bufs)
{
    nb_pre_list_init(bufs);
    bufs->len = 0;
}

void
nb_bufs_free(struct NB_Bufs* bufs)
{
    struct NB_Buf* b = nb_pre_list_at(bufs, 0);
    for (int i = 0; i < bufs->count; ++i, ++b) {
        nb_buf_free(b);
    }
    nb_pre_list_free(bufs);
}

struct NB_Buf*
nb_bufs_push(struct NB_Bufs* bufs, struct NB_Buf* buf)
{
    nb_pre_list_push(bufs, struct NB_Buf, *buf);
    bufs->len += buf->len;
    return buf;
}

struct NB_Buf*
nb_bufs_push_shared(struct NB_Bufs* bufs, uint8_t* data, int len)
{
    struct NB_Buf* b;
    nb_pre_list_get_push_ptr(bufs, struct NB_Buf, b);
    nb_buf_init_shared(b, data, len);
    bufs->len += len;
    return b;
}

struct NB_Buf*
nb_bufs_push_owned(struct NB_Bufs* bufs, uint8_t* data, int len)
{
    struct NB_Buf* b;
    nb_pre_list_get_push_ptr(bufs, struct NB_Buf, b);
    nb_buf_init_owned(b, data, len);
    bufs->len += len;
    return b;
}

struct NB_Buf*
nb_bufs_push_copy(struct NB_Bufs* bufs, uint8_t* data, int len)
{
    struct NB_Buf* b;
    nb_pre_list_get_push_ptr(bufs, struct NB_Buf, b);
    nb_buf_init_copy(b, data, len);
    bufs->len += len;
    return b;
}

struct NB_Buf*
nb_bufs_push_alloc(struct NB_Bufs* bufs, int len)
{
    struct NB_Buf* b;
    nb_pre_list_get_push_ptr(bufs, struct NB_Buf, b);
    nb_buf_init_alloc(b, len);
    bufs->len += len;
    return b;
}

struct NB_Buf*
nb_bufs_push_zeros(struct NB_Bufs* bufs, int len)
{
    struct NB_Buf* b;
    nb_pre_list_get_push_ptr(bufs, struct NB_Buf, b);
    nb_buf_init_zeros(b, len);
    bufs->len += len;
    return b;
}

void
nb_bufs_copy(struct NB_Bufs* bufs, struct NB_Bufs* source)
{
    struct NB_Buf b;
    nb_buf_init_alloc(&b, source->len);
    nb_bufs_read(source, b.data, b.len);
    nb_bufs_push(bufs, &b);
}

uint8_t*
nb_bufs_merge(struct NB_Bufs* bufs, struct NB_Buf* b)
{
    if (bufs->count <= 0) {
        if (b) nb_buf_init(b);
        return 0;
    }
    if (bufs->count == 1) {
        struct NB_Buf* b0 = nb_pre_list_at(bufs, 0);
        if (b) {
            *b = *b0;
        } else {
            b = b0;
        }
    } else {
        struct NB_Buf local_buf;
        if (!b) b = &local_buf;
        nb_buf_init_alloc(b, bufs->len);
        nb_bufs_read(bufs, b->data, b->len);
        nb_bufs_free(bufs);
        nb_bufs_init(bufs);
        nb_bufs_push(bufs, b);
    }
    return b->data;
}

uint8_t*
nb_bufs_detach(struct NB_Bufs* bufs, struct NB_Buf* b)
{
    if (bufs->count <= 0) {
        if (b) nb_buf_init(b);
        return 0;
    }
    struct NB_Buf* b0 = nb_pre_list_at(bufs, 0);
    if (bufs->count == 1 && b0->deleter == nb_buf_default_deleter) {
        if (b) *b = *b0;
        nb_bufs_init(bufs);
    } else {
        struct NB_Buf local_buf;
        if (!b) b = &local_buf;
        nb_buf_init_alloc(b, bufs->len);
        nb_bufs_read(bufs, b->data, b->len);
        nb_bufs_free(bufs);
        nb_bufs_init(bufs);
    }
    return b->data;
}

int
nb_bufs_read(struct NB_Bufs* bufs, void* target, int len)
{
    int pos = 0;
    struct NB_Buf* b = nb_pre_list_at(bufs, 0);
    for (int i = 0; i < bufs->count; ++i, ++b) {
        if (pos + b->len > len) {
            memcpy(((char*)target) + pos, b->data, len - pos);
            return len;
        }
        memcpy(((char*)target) + pos, b->data, b->len);
        pos += b->len;
    }
    return pos;
}

void
nb_bufs_truncate(struct NB_Bufs* bufs, int len)
{
    int trunc = bufs->len - len;
    if (trunc <= 0) return;
    while (trunc > 0) {
        struct NB_Buf* b = nb_bufs_get(bufs, bufs->count - 1);
        if (b->len > trunc) {
            b->len -= trunc;
            trunc = 0;
        } else {
            trunc -= b->len;
            nb_buf_free(b);
            bufs->count--;
        }
    }
    bufs->len = len;
}

void
nb_bufs_push_printf(struct NB_Bufs* bufs, int alloc, const char* fmt, ...)
{
    va_list va;
    va_start(va, fmt);
    nb_bufs_push_vprintf(bufs, alloc, fmt, va);
    va_end(va);
}

void
nb_bufs_push_vprintf(struct NB_Bufs* bufs, int alloc, const char* fmt, va_list va)
{
    struct NB_Buf* b = nb_bufs_push_alloc(bufs, (alloc > 0 ? alloc : 256));
    int len = vsnprintf((char*)b->data, b->len, fmt, va);
    int trunc = b->len - len;
    bufs->len -= trunc;
    b->len -= trunc;
}

static uint8_t
_from_hex(char c)
{
    switch (c) {
    case '0':
        return 0;
    case '1':
        return 1;
    case '2':
        return 2;
    case '3':
        return 3;
    case '4':
        return 4;
    case '5':
        return 5;
    case '6':
        return 6;
    case '7':
        return 7;
    case '8':
        return 8;
    case '9':
        return 9;
    case 'a':
    case 'A':
        return 10;
    case 'b':
    case 'B':
        return 11;
    case 'c':
    case 'C':
        return 12;
    case 'd':
    case 'D':
        return 13;
    case 'e':
    case 'E':
        return 14;
    case 'f':
    case 'F':
        return 15;
    default:
        return 0;
    }
}
}
