/* Copyright (C) 2016 NooBaa */
#pragma once

#include "struct_buf.h"
#include <node_api.h>

#ifdef __cplusplus
    #include <napi.h>
#endif

/**
 * Convert a JavaScript number value to a 32-bit unsigned integer.
 * @param v JavaScript value expected to be a Number.
 * @returns The value converted to a `uint32_t`.
 */
/**
 * Convert a JavaScript number value to a 32-bit signed integer.
 * @param v JavaScript value expected to be a Number.
 * @returns The value converted to an `int32_t`.
 */
/**
 * Convert a JavaScript number value to a 64-bit signed integer.
 * @param v JavaScript value expected to be a Number.
 * @returns The value converted to an `int64_t`.
 */
/**
 * Convert a JavaScript string value to a UTF-8 std::string.
 * @param v JavaScript value expected to be a String.
 * @returns The UTF-8 encoded `std::string`.
 */
/**
 * Parse a JavaScript string value as a hexadecimal unsigned 64-bit integer.
 * @param v JavaScript value expected to be a String representing a hex number.
 * @returns The parsed `uint64_t` value.
 */
/**
 * Retrieve a named property from a JavaScript object and convert it to a 32-bit unsigned integer.
 * @param obj JavaScript object containing the property.
 * @param key Property name to read.
 * @returns The property value converted to a `uint32_t`.
 */
/**
 * Retrieve a named property from a JavaScript object and convert it to a 32-bit signed integer.
 * @param obj JavaScript object containing the property.
 * @param key Property name to read.
 * @returns The property value converted to an `int32_t`.
 */
/**
 * Retrieve a named property from a JavaScript object and convert it to a 64-bit signed integer.
 * @param obj JavaScript object containing the property.
 * @param key Property name to read.
 * @returns The property value converted to an `int64_t`.
 */
/**
 * Retrieve a named property from a JavaScript object and convert it to a UTF-8 std::string.
 * @param obj JavaScript object containing the property.
 * @param key Property name to read.
 * @returns The property value as a UTF-8 `std::string`.
 */
/**
 * Retrieve a named property from a JavaScript object and parse it as a hexadecimal unsigned 64-bit integer.
 * @param obj JavaScript object containing the property.
 * @param key Property name to read.
 * @returns The parsed `uint64_t` value.
 */
/**
 * Retrieve a named numeric property from a JavaScript object; return a default if the property is not a number.
 * @param obj JavaScript object containing the property.
 * @param key Property name to read.
 * @param default_value Value to return when the property is not a Number.
 * @returns The property value converted to a `uint32_t`, or `default_value` if not a number.
 */
/**
 * Retrieve a named numeric property from a JavaScript object; return a default if the property is not a number.
 * @param obj JavaScript object containing the property.
 * @param key Property name to read.
 * @param default_value Value to return when the property is not a Number.
 * @returns The property value converted to an `int32_t`, or `default_value` if not a number.
 */
/**
 * Retrieve a named numeric property from a JavaScript object; return a default if the property is not a number.
 * @param obj JavaScript object containing the property.
 * @param key Property name to read.
 * @param default_value Value to return when the property is not a Number.
 * @returns The property value converted to an `int64_t`, or `default_value` if not a number.
 */
/**
 * Retrieve a named string property from a JavaScript object; return a default if the property is not a string.
 * @param obj JavaScript object containing the property.
 * @param key Property name to read.
 * @param default_value Value to return when the property is not a String.
 * @returns The property value as a UTF-8 `std::string`, or `default_value` if not a string.
 */
/**
 * Retrieve a named string property from a JavaScript object and parse it as a hex unsigned 64-bit integer; return a default if the property is not a string.
 * @param obj JavaScript object containing the property.
 * @param key Property name to read.
 * @param default_value Value to return when the property is not a String.
 * @returns The parsed `uint64_t` value, or `default_value` if not a string.
 */
/**
 * Read an integer property from a JavaScript object into a C `int`.
 * @param env N-API environment.
 * @param obj JavaScript object to read from.
 * @param name Property name to read.
 * @param p_num Pointer to an `int` to receive the value.
 */
/**
 * Set an integer property on a JavaScript object.
 * @param env N-API environment.
 * @param obj JavaScript object to modify.
 * @param name Property name to set.
 * @param num Integer value to assign.
 */
/**
 * Read a string property from a JavaScript object into a C buffer.
 * @param env N-API environment.
 * @param obj JavaScript object to read from.
 * @param name Property name to read.
 * @param str Destination buffer to receive the string (UTF-8).
 * @param max Maximum number of bytes to write into `str`.
 */
/**
 * Set a string property on a JavaScript object from a C buffer.
 * @param env N-API environment.
 * @param obj JavaScript object to modify.
 * @param name Property name to set.
 * @param str Source buffer containing the string (UTF-8).
 * @param len Number of bytes from `str` to use.
 */
/**
 * Read a binary buffer property from a JavaScript object into an `NB_Buf`.
 * @param env N-API environment.
 * @param obj JavaScript object to read from.
 * @param name Property name to read.
 * @param b Pointer to an `NB_Buf` to receive the data.
 */
/**
 * Set a binary buffer property on a JavaScript object from an `NB_Buf`.
 * @param env N-API environment.
 * @param obj JavaScript object to modify.
 * @param name Property name to set.
 * @param b Pointer to an `NB_Buf` containing the data.
 */
/**
 * Read a base64-encoded buffer property from a JavaScript object into an `NB_Buf`.
 * @param env N-API environment.
 * @param obj JavaScript object to read from.
 * @param name Property name to read.
 * @param b Pointer to an `NB_Buf` to receive the decoded data.
 */
/**
 * Set a property on a JavaScript object from an `NB_Buf`, encoding the data as base64.
 * @param env N-API environment.
 * @param obj JavaScript object to modify.
 * @param name Property name to set.
 * @param b Pointer to an `NB_Buf` containing the data to encode.
 */
/**
 * Read an array of buffers property from a JavaScript object into an `NB_Bufs`.
 * @param env N-API environment.
 * @param obj JavaScript object to read from.
 * @param name Property name to read.
 * @param bufs Pointer to an `NB_Bufs` to receive the data.
 */
/**
 * Set an array of buffers property on a JavaScript object from an `NB_Bufs`.
 * @param env N-API environment.
 * @param obj JavaScript object to modify.
 * @param name Property name to set.
 * @param bufs Pointer to an `NB_Bufs` containing the data.
 */
/**
 * Finalizer used to free native data associated with a N-API object.
 * @param env N-API environment.
 * @param data Pointer to the native data to free.
 * @param hint User-provided hint passed to the finalizer.
 */
namespace noobaa
{

// single value getters

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
    return std::stoull(napi_get_str(v), nullptr, 16);
}

// object property getters

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