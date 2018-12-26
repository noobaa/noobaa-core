/* Copyright (C) 2016 NooBaa */
#pragma once

#include <nan.h>
#include <node.h>
#include <node_buffer.h>
#include <uv.h>
#include <v8.h>

#include "common.h"

namespace noobaa
{

typedef std::shared_ptr<Nan::Callback> NanCallbackSharedPtr;

template <class T>
inline v8::Local<T>
Unmaybe(v8::Local<T> h)
{
    return h;
}
template <class T>
inline v8::Local<T>
Unmaybe(Nan::MaybeLocal<T> h)
{
    return h.ToLocalChecked();
}
template <class T>
inline T
Unmaybe(Nan::Maybe<T> h)
{
    return h.ToChecked();
}
inline int
NanKey(int i)
{
    return i;
}
inline v8::Local<v8::Value>
NanKey(const char* s)
{
    return Nan::New(s).ToLocalChecked();
}
inline v8::Local<v8::Value>
NanKey(std::string s)
{
    return Nan::New(s).ToLocalChecked();
}

#define NAN_STR(str) (Nan::New(str).ToLocalChecked())
#define NAN_INT(i) (Nan::New<v8::Integer>(i))
#define NAN_TO_INT(i) (i->Int32Value(Nan::GetCurrentContext()).ToChecked())
#define NAN_NEW_OBJ() (Nan::New<v8::Object>())
#define NAN_NEW_ARR(len) (Nan::New<v8::Array>(len))
#define NAN_GET(obj, key) (Nan::Get(obj, NanKey(key)).ToLocalChecked())
#define NAN_UNWRAP_THIS(type) (Unwrap<type>(info.This()))
#define NAN_UNWRAP_OBJ(type, obj) (Unwrap<type>(Nan::To<v8::Object>(obj).ToLocalChecked()))
#define NAN_GET_UNWRAP(type, obj, key) \
    (Unwrap<type>(Nan::To<v8::Object>(NAN_GET(obj, key)).ToLocalChecked()))
#define NAN_GET_STR(obj, key) *Nan::Utf8String(NAN_GET(obj, key))
#define NAN_GET_OBJ(obj, key) (NAN_GET(obj, key).As<v8::Object>())
#define NAN_GET_ARR(obj, key) (NAN_GET(obj, key).As<v8::Array>())
#define NAN_GET_INT(obj, key) (NAN_TO_INT(NAN_GET(obj, key)))
#define NAN_GET_BUF(obj, key) \
    Buf(node::Buffer::Data(NAN_GET_OBJ(obj, key)), node::Buffer::Length(NAN_GET_OBJ(obj, key)))

#define NAN_SET(obj, key, val) (Nan::Set(obj, NanKey(key), val))
#define NAN_SET_STR(obj, key, val) (NAN_SET(obj, key, NAN_STR(val)))
#define NAN_SET_INT(obj, key, val) (NAN_SET(obj, key, Nan::New(val)))
#define NAN_SET_NUM(obj, key, val) (NAN_SET(obj, key, Nan::New<v8::Number>(val)))
#define NAN_SET_BUF_COPY(obj, key, buf) \
    (NAN_SET(obj, key, Nan::CopyBuffer(buf.cdata(), buf.length()).ToLocalChecked()))
#define NAN_SET_BUF_DETACH(obj, key, buf)                                              \
    do {                                                                               \
        assert(buf.unique_alloc());                                                    \
        NAN_SET(obj, key, Nan::NewBuffer(buf.cdata(), buf.length()).ToLocalChecked()); \
        buf.detach_alloc();                                                            \
    } while (0)

#define NAN_ERR(msg) (Nan::To<v8::Object>(Nan::Error(msg)).ToLocalChecked())
#define NAN_RETURN(val)                 \
    do {                                \
        info.GetReturnValue().Set(val); \
        return;                         \
    } while (0)

#define NAN_CALLBACK(obj, func_name, argc, argv) \
    Nan::Call(NAN_GET(obj, func_name).As<v8::Function>(), obj, argc, argv)

#define NAN_MAKE_CTOR_CALL(ctor)                                                             \
    do {                                                                                     \
        if (!info.IsConstructCall()) {                                                       \
            /* Invoked as plain function call, turn into construct 'new' call. */            \
            int argc = info.Length();                                                        \
            std::vector<v8::Local<v8::Value>> argv(argc);                                    \
            for (int i = 0; i < argc; ++i) {                                                 \
                argv[i] = info[i];                                                           \
            }                                                                                \
            NAN_RETURN(                                                                      \
                Nan::CallAsConstructor(Nan::New(ctor), argc, argv.data()).ToLocalChecked()); \
        }                                                                                    \
    } while (0)

#define NAN_COPY_OPTIONS_TO_WRAPPER(obj, options)                    \
    do {                                                             \
        if (!options.IsEmpty()) {                                    \
            v8::Local<v8::Array> keys = options->GetPropertyNames(); \
            for (uint32_t i = 0; i < keys->Length(); ++i) {          \
                v8::Local<v8::Value> key = keys->Get(i);             \
                v8::Local<v8::Value> val = options->Get(key);        \
                Nan::Set(obj, key, val);                             \
            }                                                        \
        }                                                            \
    } while (0)

#define NAUV_CALLBACK_STATUS(func_name, handle_def) void func_name(handle_def, int status)

#if NAUV_UVVERSION < 0x000b17

#error OLD VERSION OF UV!
#define NAUV_CALLBACK(func_name, handle_def) void func_name(handle_def, int status)
#define NAUV_IP4_ADDR(address, port, sin4) *sin4 = uv_ip4_addr(address, port)
#define NAUV_IP6_ADDR(address, port, sin6) *sin6 = uv_ip6_addr(address, port)
#define NAUV_UDP_ADDR(sinp) *sinp
#define NAUV_CALL(fcall)                                                        \
    do {                                                                        \
        if (fcall) {                                                            \
            PANIC(                                                              \
                __FUNCTION__ << ": " << #fcall << " - "                         \
                             << uv_strerror(uv_last_error(uv_default_loop()))); \
        }                                                                       \
    } while (0)
#define NAUV_ALLOC_CB_WRAP(func_name, alloc_func)                  \
    uv_buf_t func_name(uv_handle_t* handle, size_t suggested_size) \
    {                                                              \
        uv_buf_t buf;                                              \
        alloc_func(handle, suggested_size, buf);                   \
        return buf;                                                \
    }
#define NAUV_UDP_RECEIVE_CB_WRAP(func_name, receive_func)                                     \
    void func_name(                                                                           \
        uv_udp_t* handle, ssize_t nread, uv_buf_t buf, struct sockaddr* addr, unsigned flags) \
    {                                                                                         \
        receive_func(handle, nread, &buf, addr, flags);                                       \
    }
#define NAUV_READ_CB_WRAP(func_name, read_func)                      \
    void func_name(uv_stream_t* handle, ssize_t nread, uv_buf_t buf) \
    {                                                                \
        read_func(handle, nread, &buf);                              \
    }

#else

#define NAUV_CALLBACK(func_name, handle_def) void func_name(handle_def)
#define NAUV_IP4_ADDR(address, port, sin4) uv_ip4_addr(address, port, sin4)
#define NAUV_IP6_ADDR(address, port, sin6) uv_ip6_addr(address, port, sin6)
#define NAUV_UDP_ADDR(sinp) reinterpret_cast<struct sockaddr*>(sinp)
#define NAUV_CALL(fcall)                                                       \
    do {                                                                       \
        if (int rc = fcall) {                                                  \
            PANIC(__FUNCTION__ << ": " << #fcall << " - " << uv_strerror(rc)); \
        }                                                                      \
    } while (0)
#define NAUV_ALLOC_CB_WRAP(func_name, alloc_func)                             \
    void func_name(uv_handle_t* handle, size_t suggested_size, uv_buf_t* buf) \
    {                                                                         \
        alloc_func(handle, suggested_size, buf);                              \
    }
#define NAUV_UDP_RECEIVE_CB_WRAP(func_name, receive_func) \
    void func_name(                                       \
        uv_udp_t* handle,                                 \
        ssize_t nread,                                    \
        const uv_buf_t* buf,                              \
        const struct sockaddr* addr,                      \
        unsigned flags)                                   \
    {                                                     \
        receive_func(handle, nread, buf, addr, flags);    \
    }
#define NAUV_READ_CB_WRAP(func_name, read_func)                             \
    void func_name(uv_stream_t* handle, ssize_t nread, const uv_buf_t* buf) \
    {                                                                       \
        read_func(handle, nread, buf);                                      \
    }

#endif

} // namespace noobaa
