/* Copyright (C) 2016 NooBaa */
#pragma once

#include <algorithm>
#include <assert.h>
#include <exception>
#include <functional>
#include <iostream>
#include <memory>
#include <sstream>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include "backtrace.h"

namespace noobaa
{

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
#define DBG(level, x)             \
    do {                          \
        if (DBG_VISIBLE(level)) { \
            LOG(x);               \
        }                         \
    } while (0)
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

#define PANIC(info)                                                                        \
    do {                                                                                   \
        std::cerr << "PANIC: " << info << " function " << __func__ << " file " << __FILE__ \
                  << " line " << __LINE__ << std::endl;                                    \
        abort();                                                                           \
    } while (0)

#ifdef NDEBUG
#define ASSERT(...)
#else
#define ASSERT(cond, info)                                                                  \
    do {                                                                                    \
        if (!(cond)) {                                                                      \
            std::cerr << "ASSERT FAILED: " << #cond << " function " << __func__ << " file " \
                      << __FILE__ << " line " << __LINE__ << ": " << info << std::endl;     \
            abort();                                                                        \
        }                                                                                   \
    } while (0)
#endif

class XSTR
{
public:
    std::stringstream stream;

    operator std::string() { return stream.str(); }

    template <class T>
    XSTR& operator<<(const T& x)
    {
        stream << x;
        return *this;
    }
};

class StackCleaner
{
public:
    StackCleaner(std::function<void()> func)
        : _func(func) {}
    ~StackCleaner() { _func(); }

private:
    std::function<void()> _func;
};

class Exception : public std::exception
{
public:
    Exception(std::string msg)
        : _msg(msg)
        , _bt(new Backtrace()) {}

    virtual ~Exception() throw() {}

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

} // namespace noobaa
