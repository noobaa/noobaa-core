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

#define NAN_STR(str) (Nan::New(str).ToLocalChecked())
#define NAN_GET(obj, key) (Nan::Get(obj, NAN_STR(key)).ToLocalChecked())
#define NAN_UNWRAP_THIS(type) (Unwrap<type>(info.This()))
#define NAN_GET_UNWRAP(type, obj, key) (Unwrap<type>(Nan::To<v8::Object>(NAN_GET(obj, key)).ToLocalChecked()))
#define NAN_GET_STR(obj, key) *Nan::Utf8String(Nan::Get(obj, NAN_STR(key)).ToLocalChecked())
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
