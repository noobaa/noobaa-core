/* Copyright (C) 2016 NooBaa */
#pragma once

#include <functional>
#include <memory>
#include <stdarg.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

namespace noobaa
{

#define NB_BUF_PAGE_SIZE 4096

typedef void (*NB_Buf_Deleter)(void*, const char*, size_t);

struct NB_Buf {
    uint8_t* data;
    int len;
    NB_Buf_Deleter deleter;
    void* deleter_arg;
};

struct NB_Bufs {
    struct NB_Buf prealloc[2];
    struct NB_Buf* arr;
    int capacity;
    int count;
    int len;
};

#define nb_new(type) ((type*)malloc(sizeof(type)))
#define nb_new_arr(count, type) ((type*)malloc(count * sizeof(type)))
#define nb_new_mem(len) ((uint8_t*)malloc((len)))

#define nb_renew(p, type) ((type*)realloc((p), sizeof((type))))
#define nb_renew_arr(p, count, type) ((type*)realloc(p, (count) * sizeof(type)))
#define nb_renew_mem(p, len) ((uint8_t*)realloc((p), (len)))

#define nb_free(p) (free((p)))

#define nb_list_init(list)    \
    do {                      \
        (list)->arr = 0;      \
        (list)->capacity = 0; \
        (list)->count = 0;    \
    } while (0)

#define nb_list_free(list)        \
    do {                          \
        if ((list)->arr) {        \
            nb_free((list)->arr); \
        }                         \
    } while (0)

#define nb_list_get_push_ptr(list, type, p_item)                             \
    do {                                                                     \
        if ((list)->count == (list)->capacity) {                             \
            switch ((list)->capacity) {                                      \
            case 0:                                                          \
                (list)->capacity = 2;                                        \
                break;                                                       \
            case 2:                                                          \
                (list)->capacity = 8;                                        \
                break;                                                       \
            default:                                                         \
                (list)->capacity *= 2;                                       \
                break;                                                       \
            }                                                                \
            (list)->arr = nb_renew_arr((list)->arr, (list)->capacity, type); \
        }                                                                    \
        p_item = (list)->arr + (list)->count;                                \
        (list)->count++;                                                     \
    } while (0)

#define nb_list_push(list, type, value)           \
    do {                                          \
        type* p_item;                             \
        nb_list_get_push_ptr(list, type, p_item); \
        *p_item = value;                          \
    } while (0)

#define nb_pre_list_init(list)                                                     \
    do {                                                                           \
        (list)->arr = 0;                                                           \
        (list)->capacity = sizeof((list)->prealloc) / sizeof((list)->prealloc[0]); \
        (list)->count = 0;                                                         \
    } while (0)

#define nb_pre_list_free(list)    \
    do {                          \
        if ((list)->arr) {        \
            nb_free((list)->arr); \
        }                         \
    } while (0)

#define nb_pre_list_at(list, i) \
    ((i) >= (list)->count ? 0 : ((list)->arr ? (list)->arr : (list)->prealloc) + (i))

#define nb_pre_list_get_push_ptr(list, type, p_item)                             \
    do {                                                                         \
        if ((list)->arr) {                                                       \
            if ((list)->count == (list)->capacity) {                             \
                switch ((list)->capacity) {                                      \
                case 0:                                                          \
                    (list)->capacity = 2;                                        \
                    break;                                                       \
                case 2:                                                          \
                    (list)->capacity = 8;                                        \
                    break;                                                       \
                default:                                                         \
                    (list)->capacity *= 2;                                       \
                    break;                                                       \
                }                                                                \
                (list)->arr = nb_renew_arr((list)->arr, (list)->capacity, type); \
            }                                                                    \
            p_item = (list)->arr + (list)->count;                                \
        } else {                                                                 \
            if ((list)->count == (list)->capacity) {                             \
                (list)->capacity *= 2;                                           \
                (list)->arr = nb_new_arr((list)->capacity, type);                \
                memcpy((list)->arr, (list)->prealloc, sizeof((list)->prealloc)); \
                p_item = (list)->arr + (list)->count;                            \
            } else {                                                             \
                p_item = (list)->prealloc + (list)->count;                       \
            }                                                                    \
        }                                                                        \
        (list)->count++;                                                         \
    } while (0)

#define nb_pre_list_push(list, type, value)           \
    do {                                              \
        type* p_item;                                 \
        nb_pre_list_get_push_ptr(list, type, p_item); \
        *p_item = value;                              \
    } while (0)

void nb_buf_init(struct NB_Buf* buf);
void nb_buf_init_shared(struct NB_Buf* buf, uint8_t* data, int len);
void nb_buf_init_owned(struct NB_Buf* buf, uint8_t* data, int len);
void nb_buf_init_copy(struct NB_Buf* buf, uint8_t* data, int len);
uint8_t* nb_buf_init_alloc(struct NB_Buf* buf, int len);
void nb_buf_init_zeros(struct NB_Buf* buf, int len);
void nb_buf_init_hex_str(struct NB_Buf* buf, struct NB_Buf* source);
void nb_buf_init_from_hex(struct NB_Buf* buf, struct NB_Buf* source_hex);
void nb_buf_free(struct NB_Buf* buf);
void nb_buf_default_deleter(void* arg, const char* data, size_t len);

void nb_bufs_init(struct NB_Bufs* bufs);
void nb_bufs_free(struct NB_Bufs* bufs);
struct NB_Buf* nb_bufs_push(struct NB_Bufs* bufs, struct NB_Buf* buf);
struct NB_Buf* nb_bufs_push_shared(struct NB_Bufs* bufs, uint8_t* data, int len);
struct NB_Buf* nb_bufs_push_owned(struct NB_Bufs* bufs, uint8_t* data, int len);
struct NB_Buf* nb_bufs_push_copy(struct NB_Bufs* bufs, uint8_t* data, int len);
struct NB_Buf* nb_bufs_push_alloc(struct NB_Bufs* bufs, int len);
struct NB_Buf* nb_bufs_push_zeros(struct NB_Bufs* bufs, int len);
void nb_bufs_copy(struct NB_Bufs* bufs, struct NB_Bufs* source);
uint8_t* nb_bufs_merge(struct NB_Bufs* bufs, struct NB_Buf* b);
uint8_t* nb_bufs_detach(struct NB_Bufs* bufs, struct NB_Buf* b);
int nb_bufs_read(struct NB_Bufs* bufs, void* target, int len);
void nb_bufs_truncate(struct NB_Bufs* bufs, int len);
void nb_bufs_push_printf(struct NB_Bufs* bufs, int alloc, const char* fmt, ...);
void nb_bufs_push_vprintf(struct NB_Bufs* bufs, int alloc, const char* fmt, va_list va);

static inline struct NB_Buf*
nb_bufs_get(struct NB_Bufs* bufs, int index)
{
    return nb_pre_list_at(bufs, index);
}
}
