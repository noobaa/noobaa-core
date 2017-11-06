/* Copyright (C) 2016 NooBaa */
#pragma once

#include "struct_buf.h"
#include <node_api.h>

#ifdef __cplusplus
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wgnu-zero-variadic-macro-arguments"
// opened an issue on -Wgnu-zero-variadic-macro-arguments -
// https://github.com/nodejs/node-addon-api/issues/174
#include <napi.h>
#pragma GCC diagnostic pop
#endif

namespace noobaa
{

void nb_napi_get_int(napi_env env, napi_value obj, const char* name, int* p_num);
void nb_napi_set_int(napi_env env, napi_value obj, const char* name, int num);
void nb_napi_get_str(napi_env env, napi_value obj, const char* name, char* str, int max);
void nb_napi_set_str(napi_env env, napi_value obj, const char* name, const char* str, int len);
void nb_napi_get_buf(napi_env env, napi_value obj, const char* name, struct NB_Buf* b);
void nb_napi_set_buf(napi_env env, napi_value obj, const char* name, struct NB_Buf* b);
void nb_napi_get_buf_b64(napi_env env, napi_value obj, const char* name, struct NB_Buf* b);
void nb_napi_set_buf_b64(napi_env env, napi_value obj, const char* name, struct NB_Buf* b);
void nb_napi_get_bufs(napi_env env, napi_value obj, const char* name, struct NB_Bufs* bufs);
void nb_napi_set_bufs(napi_env env, napi_value obj, const char* name, struct NB_Bufs* bufs);
void nb_napi_finalize_free_data(napi_env env, void* data, void* hint);
}
