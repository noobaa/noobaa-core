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

#define NAN_METHOD_TO_SELF(clazz, method) \
    static NAN_METHOD(method) \
    { \
        return Unwrap<clazz>(args.This())->_ ## method(args); \
    }

#define NAN_ACCESSOR_GETTER(method) \
    v8::Handle<v8::Value> method(v8::Local<v8::String> property, const v8::AccessorInfo &info)

#define NAN_ACCESSOR_SETTER(method) \
    void method(v8::Local<v8::String> property, v8::Local<v8::Value> value, const v8::AccessorInfo &info)

#define NAN_MAKE_CTOR_CALL(ctor) \
    do { \
        if (!args.IsConstructCall()) { \
            /* Invoked as plain function call, turn into construct 'new' call. */ \
            int argc = args.Length(); \
            std::vector<v8::Handle<v8::Value> > argv(argc); \
            for (int i=0; i<argc; ++i) { \
                argv[i] = args[i]; \
            } \
            NanReturnValue(ctor->NewInstance(argc, argv.data())); \
        } \
    } while (0)

#define NAN_COPY_OPTIONS_TO_WRAPPER(obj, options) \
    do { \
        v8::Local<v8::Array> keys = options->GetPropertyNames(); \
        for (uint32_t i=0; i<keys->Length(); ++i) { \
            v8::Local<v8::Value> key = keys->Get(i); \
            v8::Local<v8::Value> val = options->Get(key); \
            obj->Set(key, val); \
        } \
    } while (0)

typedef std::shared_ptr<NanCallback> NanCallbackSharedPtr;

#endif // COMMON_H_
