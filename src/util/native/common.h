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

#define NAN_METHOD_TO_SELF(clazz, method) \
    static NAN_METHOD(method) \
    { \
        return Unwrap<clazz>(args.This())->_ ## method(args); \
    }

typedef std::shared_ptr<NanCallback> NanCallbackRef;

template <typename T>
inline T min(const T& a, const T& b)
{
    return b < a ? b : a;
}

template <typename T>
inline T max(const T& a, const T& b)
{
    return b > a ? b : a;
}

#endif // COMMON_H_
