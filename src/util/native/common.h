#ifndef COMMON_H_
#define COMMON_H_

#include <stdint.h>
#include <stddef.h>
#include <stdexcept>
#include <assert.h>
#include <memory>
#include <vector>
#include <deque>
#include <list>
#include <map>
#include <exception>
#include <iostream>

#include <v8.h>
#include <uv.h>
#include <node.h>
#include <node_buffer.h>
#include <nan.h>

#include "buf.h"

#define NAN_METHOD_TO_SELF(clazz, method) \
    static NAN_METHOD(method) \
    { \
        return Unwrap<clazz>(args.This())->_ ## method(args); \
    }

typedef std::shared_ptr<NanCallback> NanCallbackRef;

#endif // COMMON_H_
