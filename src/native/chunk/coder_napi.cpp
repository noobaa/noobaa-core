/* Copyright (C) 2016 NooBaa */
#include "../util/b64.h"
#include "../util/napi.h"
#include "coder.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

namespace noobaa
{

#define CODER_JS_SIGNATURE "function chunk_coder('enc'|'dec', chunk/s, callback?)"

struct CoderAsync {
    struct NB_Coder_Chunk* chunks;
    int chunks_count;
    napi_ref r_chunks;
    napi_ref r_callback;
    napi_async_work work;
};

static napi_value _nb_chunk_coder(napi_env env, napi_callback_info info);
static void _nb_coder_async_execute(napi_env env, void* data);
static void _nb_coder_async_complete(napi_env env, napi_status status, void* data);
static void _nb_coder_load_chunk(napi_env env, napi_value v_chunk, struct NB_Coder_Chunk* chunk);
static void _nb_coder_update_chunk(
    napi_env env, napi_value v_chunk, napi_value* v_err, struct NB_Coder_Chunk* chunk);

void
chunk_coder_napi(napi_env env, napi_value exports)
{
    nb_chunk_coder_init();
    napi_value func = 0;
    napi_create_function(env, "chunk_coder", NAPI_AUTO_LENGTH, _nb_chunk_coder, NULL, &func);
    napi_set_named_property(env, exports, "chunk_coder", func);
}

static napi_value
_nb_chunk_coder(napi_env env, napi_callback_info info)
{
    size_t argc = 3;
    napi_value argv[] = { 0, 0, 0 };
    napi_get_cb_info(env, info, &argc, argv, 0, 0);

    napi_value v_coder = argv[0];
    napi_value v_chunks = argv[1];
    napi_value v_callback = argv[2];
    napi_value v_async_resource_name = 0;
    napi_value v_null = 0;
    napi_valuetype typeof_chunks = napi_undefined;
    napi_valuetype typeof_callback = napi_undefined;
    bool is_chunks_array = false;
    uint32_t chunks_len = 1;
    char coder_str[8];
    NB_Coder_Type coder_type = NB_Coder_Type::ENCODER;

    napi_get_null(env, &v_null);
    napi_typeof(env, v_chunks, &typeof_chunks);
    napi_typeof(env, v_callback, &typeof_callback);

    napi_get_value_string_utf8(env, v_coder, coder_str, sizeof(coder_str), 0);
    if (strncmp(coder_str, "enc", sizeof(coder_str)) == 0) {
        coder_type = NB_Coder_Type::ENCODER;
    } else if (strncmp(coder_str, "dec", sizeof(coder_str)) == 0) {
        coder_type = NB_Coder_Type::DECODER;
    } else {
        napi_throw_type_error(
            env,
            0,
            "1st argument should be coder type 'enc' or 'dec' - " CODER_JS_SIGNATURE);
        return 0;
    }

    if (typeof_chunks == napi_object && v_chunks != v_null) {
        napi_is_array(env, v_chunks, &is_chunks_array);
        if (is_chunks_array) {
            napi_get_array_length(env, v_chunks, &chunks_len);
        }
    } else {
        napi_throw_type_error(
            env,
            0,
            "2nd argument should be chunk (Object) or chunks (Object[]) - " CODER_JS_SIGNATURE);
        return 0;
    }
    if (typeof_callback != napi_function && typeof_callback != napi_undefined) {
        napi_throw_type_error(
            env,
            0,
            "3rd argument should be callback (Function) or undefined - " CODER_JS_SIGNATURE);
        return 0;
    }

    if (typeof_callback == napi_undefined) {

        napi_value v_err = 0;
        for (uint32_t i = 0; i < chunks_len; ++i) {
            struct NB_Coder_Chunk chunk;
            napi_value v_chunk = v_chunks;
            if (is_chunks_array) napi_get_element(env, v_chunks, i, &v_chunk);
            nb_chunk_init(&chunk);
            chunk.coder = coder_type;
            _nb_coder_load_chunk(env, v_chunk, &chunk);
            nb_chunk_coder(&chunk);
            _nb_coder_update_chunk(env, v_chunk, &v_err, &chunk);
            nb_chunk_free(&chunk);
        }
        if (v_err) {
            napi_throw(env, v_err);
            return 0;
        } else {
            return v_chunks;
        }

    } else {

        struct CoderAsync* async = nb_new(struct CoderAsync);
        async->chunks = nb_new_arr(chunks_len, struct NB_Coder_Chunk);
        async->chunks_count = chunks_len;

        for (uint32_t i = 0; i < chunks_len; ++i) {
            struct NB_Coder_Chunk* chunk = async->chunks + i;
            napi_value v_chunk = v_chunks;
            if (is_chunks_array) napi_get_element(env, v_chunks, i, &v_chunk);
            nb_chunk_init(chunk);
            chunk->coder = coder_type;
            _nb_coder_load_chunk(env, v_chunk, chunk);
        }

        napi_create_reference(env, v_chunks, 1, &async->r_chunks);
        napi_create_reference(env, v_callback, 1, &async->r_callback);
        napi_create_string_utf8(env, "CoderResource", NAPI_AUTO_LENGTH, &v_async_resource_name);
        napi_create_async_work(
            env, v_async_resource_name, v_async_resource_name, _nb_coder_async_execute, _nb_coder_async_complete, async, &async->work);
        napi_queue_async_work(env, async->work);
        return 0;
    }
}

static void
_nb_coder_load_chunk(napi_env env, napi_value v_chunk, struct NB_Coder_Chunk* chunk)
{
    napi_value v_config;
    napi_get_named_property(env, v_chunk, "chunk_coder_config", &v_config);
    nb_napi_get_str(
        env, v_config, "digest_type", chunk->digest_type, sizeof(chunk->digest_type));
    nb_napi_get_str(
        env, v_config, "compress_type", chunk->compress_type, sizeof(chunk->compress_type));
    nb_napi_get_str(
        env, v_config, "cipher_type", chunk->cipher_type, sizeof(chunk->cipher_type));
    nb_napi_get_str(
        env, v_config, "frag_digest_type", chunk->frag_digest_type, sizeof(chunk->frag_digest_type));
    nb_napi_get_int(env, v_config, "data_frags", &chunk->data_frags);
    nb_napi_get_int(env, v_config, "parity_frags", &chunk->parity_frags);
    nb_napi_get_str(env, v_config, "parity_type", chunk->parity_type, sizeof(chunk->parity_type));
    nb_napi_get_int(env, v_config, "lrc_group", &chunk->lrc_group);
    nb_napi_get_int(env, v_config, "lrc_frags", &chunk->lrc_frags);

    nb_napi_get_int(env, v_chunk, "size", &chunk->size);
    nb_napi_get_int(env, v_chunk, "frag_size", &chunk->frag_size);
    nb_napi_get_int(env, v_chunk, "compress_size", &chunk->compress_size);

    nb_napi_get_buf_b64(env, v_chunk, "digest_b64", &chunk->digest);
    nb_napi_get_buf_b64(env, v_chunk, "cipher_key_b64", &chunk->cipher_key);
    nb_napi_get_buf_b64(env, v_chunk, "cipher_iv_b64", &chunk->cipher_iv);
    nb_napi_get_buf_b64(env, v_chunk, "cipher_auth_tag_b64", &chunk->cipher_auth_tag);

    if (!chunk->size) {
        nb_chunk_error(chunk, "Cannot code zero size chunk");
    }

    if (chunk->coder == NB_Coder_Type::ENCODER) {

        nb_napi_get_bufs(env, v_chunk, "data", &chunk->data);

        // TODO fail if no data? - nb_chunk_error(chunk, "chunk.data should be buffer/s");

    } else if (chunk->coder == NB_Coder_Type::DECODER) {

        napi_value v_frags = 0;
        bool is_frags_array = false;
        napi_get_named_property(env, v_chunk, "frags", &v_frags);
        napi_is_array(env, v_frags, &is_frags_array);

        if (is_frags_array) {
            napi_value v_frag = 0;
            uint32_t frags_len = 0;
            napi_get_array_length(env, v_frags, &frags_len);

            chunk->frags_count = frags_len;
            chunk->frags = nb_new_arr(chunk->frags_count, struct NB_Coder_Frag);

            for (uint32_t i = 0; i < frags_len; ++i) {
                struct NB_Coder_Frag* f = chunk->frags + i;
                nb_frag_init(f);
                napi_get_element(env, v_frags, i, &v_frag);
                nb_napi_get_int(env, v_frag, "data_index", &f->data_index);
                nb_napi_get_int(env, v_frag, "parity_index", &f->parity_index);
                nb_napi_get_int(env, v_frag, "lrc_index", &f->lrc_index);
                nb_napi_get_bufs(env, v_frag, "data", &f->block);
                nb_napi_get_buf_b64(env, v_frag, "digest_b64", &f->digest);
            }
        }
    }
}

static void
_nb_coder_async_execute(napi_env env, void* data)
{
    struct CoderAsync* async = (struct CoderAsync*)data;
    for (int i = 0; i < async->chunks_count; ++i) {
        struct NB_Coder_Chunk* chunk = async->chunks + i;
        nb_chunk_coder(chunk);
    }
}

static void
_nb_coder_async_complete(napi_env env, napi_status status, void* data)
{
    struct CoderAsync* async = (struct CoderAsync*)data;
    napi_value v_global = 0;
    napi_value v_chunks = 0;
    napi_value v_callback = 0;
    bool is_chunks_array = false;

    napi_get_global(env, &v_global);
    napi_get_reference_value(env, async->r_chunks, &v_chunks);
    napi_get_reference_value(env, async->r_callback, &v_callback);
    napi_is_array(env, v_chunks, &is_chunks_array);

    napi_value v_err = 0;
    for (int i = 0; i < async->chunks_count; ++i) {
        struct NB_Coder_Chunk* chunk = async->chunks + i;
        napi_value v_chunk = v_chunks;
        if (is_chunks_array) napi_get_element(env, v_chunks, i, &v_chunk);
        _nb_coder_update_chunk(env, v_chunk, &v_err, chunk);
        nb_chunk_free(chunk);
    }

    if (!v_err) napi_get_null(env, &v_err);
    napi_value v_callback_args[] = { v_err, v_chunks };
    napi_make_callback(env, 0, v_global, v_callback, 2, v_callback_args, 0);

    napi_delete_reference(env, async->r_chunks);
    napi_delete_reference(env, async->r_callback);
    napi_delete_async_work(env, async->work);

    nb_free(async->chunks);
    nb_free(async);
}

static void
_nb_coder_update_chunk(
    napi_env env, napi_value v_chunk, napi_value* v_err, struct NB_Coder_Chunk* chunk)
{
    if (chunk->errors.count) {
        if (!*v_err) {
            napi_value v = 0;
            napi_create_string_utf8(env, "had chunk errors", NAPI_AUTO_LENGTH, &v);
            napi_create_error(env, 0, v, v_err);
        }

        napi_value v_err_chunks = 0;
        bool is_array = false;
        napi_get_named_property(env, *v_err, "chunks", &v_err_chunks);
        napi_is_array(env, v_err_chunks, &is_array);
        if (!is_array) {
            napi_create_array_with_length(env, 1, &v_err_chunks);
            napi_set_element(env, v_err_chunks, 0, v_chunk);
            napi_set_named_property(env, *v_err, "chunks", v_err_chunks);
        } else {
            uint32_t chunks_len = 0;
            napi_get_array_length(env, v_err_chunks, &chunks_len);
            napi_set_element(env, v_err_chunks, chunks_len, v_chunk);
        }

        napi_value v_errors = 0;
        napi_create_array_with_length(env, chunk->errors.count, &v_errors);
        napi_set_named_property(env, v_chunk, "errors", v_errors);
        for (int i = 0; i < chunk->errors.count; ++i) {
            napi_value v = 0;
            napi_create_string_utf8(
                env, (const char*)nb_bufs_get(&chunk->errors, i)->data, NAPI_AUTO_LENGTH, &v);
            napi_set_element(env, v_errors, i, v);
        }
        return;
    }

    if (chunk->coder == NB_Coder_Type::ENCODER) {

        nb_napi_set_int(env, v_chunk, "frag_size", chunk->frag_size);
        if (chunk->compress_type[0]) {
            nb_napi_set_int(env, v_chunk, "compress_size", chunk->compress_size);
        }
        if (chunk->digest_type[0]) {
            nb_napi_set_buf_b64(env, v_chunk, "digest_b64", &chunk->digest);
        }
        if (chunk->cipher_type[0]) {
            nb_napi_set_buf_b64(env, v_chunk, "cipher_key_b64", &chunk->cipher_key);
            if (chunk->cipher_iv.len) {
                nb_napi_set_buf_b64(env, v_chunk, "cipher_iv_b64", &chunk->cipher_iv);
            }
            if (chunk->cipher_auth_tag.len) {
                nb_napi_set_buf_b64(env, v_chunk, "cipher_auth_tag_b64", &chunk->cipher_auth_tag);
            }
        }

        napi_value v_frag = 0;
        napi_value v_frags = 0;
        napi_create_array_with_length(env, chunk->frags_count, &v_frags);
        napi_set_named_property(env, v_chunk, "frags", v_frags);

        for (int i = 0; i < chunk->frags_count; ++i) {
            struct NB_Coder_Frag* f = chunk->frags + i;
            napi_create_object(env, &v_frag);
            napi_set_element(env, v_frags, i, v_frag);
            if (f->data_index >= 0) nb_napi_set_int(env, v_frag, "data_index", f->data_index);
            if (f->parity_index >= 0) nb_napi_set_int(env, v_frag, "parity_index", f->parity_index);
            if (f->lrc_index >= 0) nb_napi_set_int(env, v_frag, "lrc_index", f->lrc_index);
            nb_napi_set_bufs(env, v_frag, "data", &f->block);
            if (chunk->frag_digest_type[0]) {
                nb_napi_set_buf_b64(env, v_frag, "digest_b64", &f->digest);
            }
        }

    } else if (chunk->coder == NB_Coder_Type::DECODER) {

        nb_napi_set_bufs(env, v_chunk, "data", &chunk->data);
    }
}
}
