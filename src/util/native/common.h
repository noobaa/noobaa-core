#ifndef COMMON_H_
#define COMMON_H_

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

#ifndef __func__
#define __func__ __FUNCTION__
#endif

#define DVAL(x) #x "=" << x << " "

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

typedef std::shared_ptr<Nan::Callback> NanCallbackSharedPtr;

template <class T>
inline v8::Local<T> UnmaybeLocal(v8::Local<T> h) {
    return h;
}
template <class T>
inline v8::Local<T> UnmaybeLocal(Nan::MaybeLocal<T> h) {
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
#define NAN_NEW_OBJ() (Nan::New<v8::Object>())
#define NAN_NEW_ARR(len) (Nan::New<v8::Array>(len))
#define NAN_GET(obj, key) (Nan::Get(obj, NanKey(key)).ToLocalChecked())
#define NAN_UNWRAP_THIS(type) (Unwrap<type>(info.This()))
#define NAN_GET_UNWRAP(type, obj, key) (Unwrap<type>(Nan::To<v8::Object>(NAN_GET(obj, key)).ToLocalChecked()))
#define NAN_GET_STR(obj, key) *Nan::Utf8String(NAN_GET(obj, key))
#define NAN_GET_OBJ(obj, key) (NAN_GET(obj, key)->ToObject())
#define NAN_GET_ARR(obj, key) (NAN_GET(obj, key).As<v8::Array>())
#define NAN_GET_INT(obj, key) (NAN_GET(obj, key)->Int32Value())
#define NAN_GET_BUF(obj, key) \
    ({ \
        auto node_buf = NAN_GET_OBJ(obj, key); \
        Buf(node::Buffer::Data(node_buf), node::Buffer::Length(node_buf)); \
    })

#define NAN_SET(obj, key, val) (Nan::Set(obj, NanKey(key), val))
#define NAN_SET_STR(obj, key, val) (NAN_SET(obj, key, NAN_STR(val)))
#define NAN_SET_INT(obj, key, val) (NAN_SET(obj, key, Nan::New(val)))
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
            std::vector<v8::Local<v8::Value> > argv(argc); \
            for (int i=0; i<argc; ++i) { \
                argv[i] = info[i]; \
            } \
            NAN_RETURN(Nan::CallAsConstructor(Nan::New(ctor), argc, argv.data()).ToLocalChecked()); \
        } \
    } while (0)

#define NAN_COPY_OPTIONS_TO_WRAPPER(obj, options) \
    do { \
        v8::Local<v8::Array> keys = options->GetPropertyNames(); \
        for (uint32_t i=0; i<keys->Length(); ++i) { \
            v8::Local<v8::Value> key = keys->Get(i); \
            v8::Local<v8::Value> val = options->Get(key); \
            Nan::Set(obj, key, val); \
        } \
    } while (0)

#endif // COMMON_H_
