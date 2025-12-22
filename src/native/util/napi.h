/* Copyright (C) 2016 NooBaa */
#pragma once

#include "struct_buf.h"
#include <node_api.h>

#ifdef __cplusplus
    #include <napi.h>
#endif

namespace noobaa
{

// create a Napi::Error from errno value
Napi::Error napi_sys_error(Napi::Env env, int errno_val, std::string msg);

// single value getters

inline bool
napi_is_defined(Napi::Value v)
{
    return !v.IsEmpty() && !v.IsUndefined() && !v.IsNull();
}

inline uint32_t
napi_get_u32(Napi::Value v)
{
    return v.As<Napi::Number>().Uint32Value();
}

inline int32_t
napi_get_i32(Napi::Value v)
{
    return v.As<Napi::Number>().Int32Value();
}

inline int64_t
napi_get_i64(Napi::Value v)
{
    return v.As<Napi::Number>().Int64Value();
}

inline std::string
napi_get_str(Napi::Value v)
{
    return v.As<Napi::String>().Utf8Value();
}

inline uint64_t
napi_get_u64_hex(Napi::Value v)
{
    auto s = napi_get_str(v);
    try {
        return std::stoull(s, nullptr, 16);
    } catch (const std::exception& e) {
        throw Napi::Error::New(v.Env(),
            std::string("Invalid u64 hex string '") + s + "': " + e.what());
    }
}

// object property getters

inline bool
napi_is_defined(Napi::Object obj, const char* key)
{
    return napi_is_defined(obj.Get(key));
}

inline uint32_t
napi_get_u32(Napi::Object obj, const char* key)
{
    return napi_get_u32(obj.Get(key));
}

inline int32_t
napi_get_i32(Napi::Object obj, const char* key)
{
    return napi_get_i32(obj.Get(key));
}

inline int64_t
napi_get_i64(Napi::Object obj, const char* key)
{
    return napi_get_i64(obj.Get(key));
}

inline std::string
napi_get_str(Napi::Object obj, const char* key)
{
    return napi_get_str(obj.Get(key));
}

inline uint64_t
napi_get_u64_hex(Napi::Object obj, const char* key)
{
    return napi_get_u64_hex(obj.Get(key));
}

// object property getters with default value

inline uint32_t
napi_get_u32_or(Napi::Object obj, const char* key, uint32_t default_value)
{
    auto v = obj.Get(key);
    if (!v.IsNumber()) return default_value;
    return napi_get_u32(v);
}

inline int32_t
napi_get_i32_or(Napi::Object obj, const char* key, int32_t default_value)
{
    auto v = obj.Get(key);
    if (!v.IsNumber()) return default_value;
    return napi_get_i32(v);
}

inline int64_t
napi_get_i64_or(Napi::Object obj, const char* key, int64_t default_value)
{
    auto v = obj.Get(key);
    if (!v.IsNumber()) return default_value;
    return napi_get_i64(v);
}

inline std::string
napi_get_str_or(Napi::Object obj, const char* key, const std::string& default_value)
{
    auto v = obj.Get(key);
    if (!v.IsString()) return default_value;
    return napi_get_str(v);
}

inline uint64_t
napi_get_u64_hex_or(Napi::Object obj, const char* key, uint64_t default_value)
{
    auto v = obj.Get(key);
    if (!v.IsString()) return default_value;
    return napi_get_u64_hex(v);
}

// low level c helpers

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
} // namespace noobaa
