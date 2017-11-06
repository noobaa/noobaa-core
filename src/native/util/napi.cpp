/* Copyright (C) 2016 NooBaa */
#include "napi.h"
#include "b64.h"

namespace noobaa
{

void
nb_napi_get_int(napi_env env, napi_value obj, const char* name, int* p_num)
{
    napi_value v = 0;
    napi_get_named_property(env, obj, name, &v);
    napi_get_value_int32(env, v, p_num);
}

void
nb_napi_set_int(napi_env env, napi_value obj, const char* name, int num)
{
    napi_value v = 0;
    napi_create_int32(env, num, &v);
    napi_set_named_property(env, obj, name, v);
}

void
nb_napi_get_str(napi_env env, napi_value obj, const char* name, char* str, int max)
{
    napi_value v = 0;
    napi_get_named_property(env, obj, name, &v);
    napi_get_value_string_utf8(env, v, str, max, 0);
}

void
nb_napi_set_str(napi_env env, napi_value obj, const char* name, const char* str, int len)
{
    napi_value v = 0;
    napi_create_string_utf8(env, str, len, &v);
    napi_set_named_property(env, obj, name, v);
}

void
nb_napi_get_buf(napi_env env, napi_value obj, const char* name, struct NB_Buf* b)
{
    napi_value v = 0;
    bool is_buffer = false;
    napi_get_named_property(env, obj, name, &v);
    napi_is_buffer(env, v, &is_buffer);
    if (is_buffer) {
        void* data = 0;
        size_t len = 0;
        napi_get_buffer_info(env, v, &data, &len);
        nb_buf_init_shared(b, (uint8_t*)data, (int)len);
    }
}

void
nb_napi_set_buf(napi_env env, napi_value obj, const char* name, struct NB_Buf* b)
{
    napi_value v = 0;
    napi_create_buffer_copy(env, b->len, b->data, 0, &v);
    napi_set_named_property(env, obj, name, v);
}

void
nb_napi_get_buf_b64(napi_env env, napi_value obj, const char* name, struct NB_Buf* b)
{
    napi_value v = 0;
    struct NB_Buf str_buf;
    size_t len = 0;
    napi_get_named_property(env, obj, name, &v);
    napi_get_value_string_utf8(env, v, 0, 0, &len);
    if (!len) return;
    nb_buf_init_alloc(&str_buf, len + 1);
    napi_get_value_string_utf8(env, v, (char*)str_buf.data, str_buf.len, 0);
    nb_buf_init_alloc(b, b64_decode_len(len));
    int r = b64_decode(str_buf.data, len, b->data);
    if (r < 0) {
        nb_buf_free(b);
        nb_buf_init(b);
    } else {
        b->len = r;
    }
    nb_buf_free(&str_buf);
}

void
nb_napi_set_buf_b64(napi_env env, napi_value obj, const char* name, struct NB_Buf* b)
{
    napi_value v = 0;
    struct NB_Buf str_buf;
    int len = b64_encode_len(b->len);
    nb_buf_init_alloc(&str_buf, len);
    int r = b64_encode(b->data, b->len, str_buf.data);
    if (r < 0) {
        nb_buf_free(b);
        nb_buf_init(b);
    } else {
        napi_create_string_utf8(env, (char*)str_buf.data, len, &v);
        napi_set_named_property(env, obj, name, v);
    }
    nb_buf_free(&str_buf);
}

void
nb_napi_get_bufs(napi_env env, napi_value obj, const char* name, struct NB_Bufs* bufs)
{
    napi_value v = 0;
    bool is_buffer = false;
    bool is_array = false;
    void* data = 0;
    size_t len = 0;

    napi_get_named_property(env, obj, name, &v);
    napi_is_buffer(env, v, &is_buffer);

    if (is_buffer) {
        napi_get_buffer_info(env, v, &data, &len);
        nb_bufs_push_shared(bufs, (uint8_t*)data, (int)len);
        return;
    }

    napi_is_array(env, v, &is_array);

    if (is_array) {
        napi_value v_buf = 0;
        uint32_t arr_len = 0;
        napi_get_array_length(env, v, &arr_len);
        for (uint32_t i = 0; i < arr_len; ++i) {
            napi_get_element(env, v, i, &v_buf);
            napi_is_buffer(env, v_buf, &is_buffer);
            if (is_buffer) {
                napi_get_buffer_info(env, v_buf, &data, &len);
                nb_bufs_push_shared(bufs, (uint8_t*)data, (int)len);
            }
        }
    }
}

void
nb_napi_set_bufs(napi_env env, napi_value obj, const char* name, struct NB_Bufs* bufs)
{
    napi_value v = 0;
    struct NB_Buf b;
    nb_bufs_detach(bufs, &b);
    napi_create_external_buffer(env, b.len, b.data, nb_napi_finalize_free_data, 0, &v);
    napi_set_named_property(env, obj, name, v);
}

void
nb_napi_finalize_free_data(napi_env env, void* data, void* hint)
{
    nb_free(data);
}
}
