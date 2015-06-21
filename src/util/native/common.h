#ifndef COMMON_H_
#define COMMON_H_

#include <iostream>
#include <exception>
#include <stdexcept>
#include <stdint.h>
#include <vector>

#include <v8.h>
#include <uv.h>
#include <node.h>
#include <node_buffer.h>
#include <nan.h>

typedef v8::Handle<v8::Object> HOBJ;
typedef v8::Handle<v8::Value> HVAL;
typedef v8::Local<v8::Value> LVAL;

#define NAN_METHOD_TO_SELF(clazz, method) \
    static NAN_METHOD(method) { \
        return Unwrap<clazz>(args.This())->_##method(args); \
    }

#endif // COMMON_H_
