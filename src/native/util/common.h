/* Copyright (C) 2016 NooBaa */
#ifndef NOOBAA__COMMON__H
#define NOOBAA__COMMON__H

#include <stdint.h>
#include <stddef.h>
#include <stdexcept>
#include <assert.h>
#include <memory>
#include <string>
#include <vector>
#include <deque>
#include <list>
#include <map>
#include <exception>
#include <iostream>
#include <sstream>
#include <iomanip>
#include <random>

#include <v8.h>
#include <uv.h>
#include <node.h>
#include <node_buffer.h>
#include <nan.h>

#include "../third_party/endian.h"
#include "backtrace.h"

namespace noobaa {

#ifndef __func__
#define __func__ __FUNCTION__
#endif

#define DVAL(x) #x "=" << x << " "

#define LOG(x) std::cout << x << std::endl

// to use DBG the module/file should use either DBG_INIT or DBG_INIT_VAR.
#define DBG_INIT(level) static int __module_debug_var__ = level
#define DBG_INIT_VAR(debug_var) static int& __module_debug_var__ = debug_var
#define DBG_SET_LEVEL(level) __module_debug_var__ = level
#define DBG_GET_LEVEL() (__module_debug_var__)
#define DBG_VISIBLE(level) (level <= __module_debug_var__)
#define DBG(level, x) \
    do { \
        if (DBG_VISIBLE(level)) { \
            LOG(x); \
        } \
    } while(0)
#define DBG0(x) DBG(0, x)
#define DBG1(x) DBG(1, x)
#define DBG2(x) DBG(2, x)
#define DBG3(x) DBG(3, x)
#define DBG4(x) DBG(4, x)
#define DBG5(x) DBG(5, x)
#define DBG6(x) DBG(6, x)
#define DBG7(x) DBG(7, x)
#define DBG8(x) DBG(8, x)
#define DBG9(x) DBG(9, x)

#define PANIC(info) \
    do { \
        std::cerr << "PANIC: " << info \
                  << " function " << __func__ \
                  << " file " << __FILE__ \
                  << " line " << __LINE__ \
                  << std::endl; \
        abort(); \
    } while(0)

#ifdef NDEBUG
# define ASSERT(...)
#else
# define ASSERT(cond, info) \
    do { \
        if (!(cond)) { \
            std::cerr << "ASSERT FAILED: " << #cond \
                      << " function " << __func__ \
                      << " file " << __FILE__ \
                      << " line " << __LINE__ \
                      << ": " << info \
                      << std::endl; \
            abort(); \
        } \
    } while(0)
#endif

class Exception : public std::exception
{
public:
    Exception(std::string msg)
        : _msg(msg)
        , _bt(new Backtrace())
    {
    }
    virtual ~Exception() throw()
    {
    }
    virtual const char* what() const throw()
    {
        return (std::string("Exception: ") + _msg).c_str();
    }
    friend std::ostream& operator<<(std::ostream& os, Exception& e)
    {
        return os << "Exception: " << e._msg << " " << *e._bt;
    }
private:
    std::string _msg;
    std::shared_ptr<Backtrace> _bt;
};

typedef std::shared_ptr<Nan::Callback> NanCallbackSharedPtr;

template <class T>
inline v8::Local<T> Unmaybe(v8::Local<T> h) {
    return h;
}
template <class T>
inline v8::Local<T> Unmaybe(Nan::MaybeLocal<T> h) {
    return h.ToLocalChecked();
}
inline int NanKey(int i) {
    return i;
}
inline v8::Local<v8::Value> NanKey(const char* s) {
    return Nan::New(s).ToLocalChecked();
}
inline v8::Local<v8::Value> NanKey(std::string s) {
    return Nan::New(s).ToLocalChecked();
}

#define NAN_STR(str) (Nan::New(str).ToLocalChecked())
#define NAN_INT(i) (Nan::New<v8::Integer>(i))
#define NAN_NEW_OBJ() (Nan::New<v8::Object>())
#define NAN_NEW_ARR(len) (Nan::New<v8::Array>(len))
#define NAN_GET(obj, key) (Nan::Get(obj, NanKey(key)).ToLocalChecked())
#define NAN_UNWRAP_THIS(type) (Unwrap<type>(info.This()))
#define NAN_UNWRAP_OBJ(type, obj) (Unwrap<type>(Nan::To<v8::Object>(obj).ToLocalChecked()))
#define NAN_GET_UNWRAP(type, obj, key) (Unwrap<type>(Nan::To<v8::Object>(NAN_GET(obj, key)).ToLocalChecked()))
#define NAN_GET_STR(obj, key) *Nan::Utf8String(NAN_GET(obj, key))
#define NAN_GET_OBJ(obj, key) (NAN_GET(obj, key)->ToObject())
#define NAN_GET_ARR(obj, key) (NAN_GET(obj, key).As<v8::Array>())
#define NAN_GET_INT(obj, key) (NAN_GET(obj, key)->Int32Value())
#define NAN_GET_BUF(obj, key) \
    Buf(node::Buffer::Data(NAN_GET_OBJ(obj, key)), \
        node::Buffer::Length(NAN_GET_OBJ(obj, key)))

#define NAN_SET(obj, key, val) (Nan::Set(obj, NanKey(key), val))
#define NAN_SET_STR(obj, key, val) (NAN_SET(obj, key, NAN_STR(val)))
#define NAN_SET_INT(obj, key, val) (NAN_SET(obj, key, Nan::New(val)))
#define NAN_SET_NUM(obj, key, val) (NAN_SET(obj, key, Nan::New<v8::Number>(val)))
#define NAN_SET_BUF_COPY(obj, key, buf) \
    (NAN_SET(obj, key, Nan::CopyBuffer(buf.cdata(), buf.length()).ToLocalChecked()))
#define NAN_SET_BUF_DETACH(obj, key, buf) \
    do { \
        assert(buf.unique_alloc()); \
        NAN_SET(obj, key, Nan::NewBuffer(buf.cdata(), buf.length()).ToLocalChecked()); \
        buf.detach_alloc(); \
    } while(0)

#define NAN_ERR(msg) (Nan::To<v8::Object>(Nan::Error(msg)).ToLocalChecked())
#define NAN_RETURN(val) \
    do { \
        info.GetReturnValue().Set(val); \
        return; \
    } while (0)

#define NAN_MAKE_CTOR_CALL(ctor) \
    do { \
        if (!info.IsConstructCall()) { \
            /* Invoked as plain function call, turn into construct 'new' call. */ \
            int argc = info.Length(); \
            std::vector<v8::Local<v8::Value>> argv(argc); \
            for (int i=0; i<argc; ++i) { \
                argv[i] = info[i]; \
            } \
            NAN_RETURN(Nan::CallAsConstructor(Nan::New(ctor), argc, argv.data()).ToLocalChecked()); \
        } \
    } while (0)

#define NAN_COPY_OPTIONS_TO_WRAPPER(obj, options) \
    do { \
        if (!options.IsEmpty()) { \
            v8::Local<v8::Array> keys = options->GetPropertyNames(); \
            for (uint32_t i=0; i<keys->Length(); ++i) { \
                v8::Local<v8::Value> key = keys->Get(i); \
                v8::Local<v8::Value> val = options->Get(key); \
                Nan::Set(obj, key, val); \
            } \
        } \
    } while (0)

# define NAUV_CALLBACK_STATUS(func_name, handle_def) \
    void func_name(handle_def, int status)

#if NAUV_UVVERSION < 0x000b17

# define NAUV_CALLBACK(func_name, handle_def) \
    void func_name(handle_def, int status)
# define NAUV_IP4_ADDR(address, port, sin4) \
    *sin4 = uv_ip4_addr(address, port)
# define NAUV_IP6_ADDR(address, port, sin6) \
    *sin6 = uv_ip6_addr(address, port)
# define NAUV_UDP_ADDR(sinp) *sinp
# define NAUV_CALL(fcall) \
    do { \
        if (fcall) { \
            PANIC(__FUNCTION__ << ": " << #fcall << " - " \
                               << uv_strerror(uv_last_error(uv_default_loop()))); \
        } \
    } while(0)
# define NAUV_ALLOC_CB_WRAP(func_name, alloc_func) \
    uv_buf_t func_name(uv_handle_t* handle, size_t suggested_size) \
    { \
        uv_buf_t buf; \
        alloc_func(handle, suggested_size, buf); \
        return buf; \
    }
# define NAUV_UDP_RECEIVE_CB_WRAP(func_name, receive_func) \
    void func_name( \
        uv_udp_t* handle, \
        ssize_t nread, \
        uv_buf_t buf, \
        struct sockaddr* addr, \
        unsigned flags) \
    { \
        receive_func(handle, nread, &buf, addr, flags); \
    }
# define NAUV_READ_CB_WRAP(func_name, read_func) \
    void func_name( \
        uv_stream_t* handle, \
        ssize_t nread, \
        uv_buf_t buf) \
    { \
        read_func(handle, nread, &buf); \
    }

#else

# define NAUV_CALLBACK(func_name, handle_def) \
    void func_name(handle_def)
# define NAUV_IP4_ADDR(address, port, sin4) \
    uv_ip4_addr(address, port, sin4)
# define NAUV_IP6_ADDR(address, port, sin6) \
    uv_ip6_addr(address, port, sin6)
# define NAUV_UDP_ADDR(sinp) reinterpret_cast<struct sockaddr*>(sinp)
# define NAUV_CALL(fcall) \
    do { \
        if (int rc = fcall) { \
            PANIC(__FUNCTION__ << ": " << #fcall << " - " << uv_strerror(rc)); \
        } \
    } while(0)
# define NAUV_ALLOC_CB_WRAP(func_name, alloc_func) \
    void func_name(uv_handle_t* handle, size_t suggested_size, uv_buf_t* buf) \
    { \
        alloc_func(handle, suggested_size, buf); \
    }
# define NAUV_UDP_RECEIVE_CB_WRAP(func_name, receive_func) \
    void func_name( \
        uv_udp_t* handle, \
        ssize_t nread, \
        const uv_buf_t* buf, \
        const struct sockaddr* addr, \
        unsigned flags) \
    { \
        receive_func(handle, nread, buf, addr, flags); \
    }
# define NAUV_READ_CB_WRAP(func_name, read_func) \
    void func_name( \
        uv_stream_t* handle, \
        ssize_t nread, \
        const uv_buf_t* buf) \
    { \
        read_func(handle, nread, buf); \
    }

#endif

} // namespace noobaa

#endif // NOOBAA__COMMON__H
