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

typedef std::shared_ptr<NanCallback> NanCallbackSharedPtr;

#endif // COMMON_H_
