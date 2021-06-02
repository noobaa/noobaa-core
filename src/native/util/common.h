/* Copyright (C) 2016 NooBaa */
#pragma once

#include <algorithm>
#include <assert.h>
#include <chrono>
#include <ctime>
#include <exception>
#include <functional>
#include <iomanip>
#include <iostream>
#include <memory>
#include <sstream>
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <unistd.h>

#include "backtrace.h"
#include "os.h"

namespace noobaa
{

#ifndef __func__
#define __func__ __FUNCTION__
#endif

#define DVAL(x) #x "=" << x << " "

#define LOG(x) std::cout << LOG_PREFIX() << x << std::endl

// to use DBG the module/file should use either DBG_INIT or DBG_INIT_VAR.
#define DBG_INIT(level) static int __module_debug_var__ = level
#define DBG_INIT_VAR(debug_var) static int& __module_debug_var__ = debug_var
#define DBG_SET_LEVEL(level) __module_debug_var__ = level
#define DBG_GET_LEVEL() (__module_debug_var__)
#define DBG_VISIBLE(level) (level <= __module_debug_var__)
#define DBG(level, x)                        \
    do {                                     \
        if (DBG_VISIBLE(level)) {            \
            LOG("[L" << level << "] " << x); \
        }                                    \
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

#define PANIC(info)                          \
    do {                                     \
        int saved = errno;                   \
        std::cerr << "PANIC: " << info       \
                  << " " << strerror(saved)  \
                  << " (" << saved << ")"    \
                  << " " << __func__ << "()" \
                  << " at " << __FILE__      \
                  << ":" << __LINE__         \
                  << std::endl;              \
        abort();                             \
    } while (0)

#define MUST0(cond)                                          \
    do {                                                     \
        auto ret = (cond);                                   \
        if (ret) {                                           \
            PANIC("MUST FAILED: " << #cond << " = " << ret); \
        }                                                    \
    } while (0)

#define MUST1(cond)                                          \
    do {                                                     \
        auto ret = (cond);                                   \
        if (!ret) {                                          \
            PANIC("MUST FAILED: " << #cond << " = " << ret); \
        }                                                    \
    } while (0)

#define MUST_SYS(cond)                                               \
    do {                                                             \
        auto ret = (cond);                                           \
        if (ret < 0) {                                               \
            PANIC("MUST SYSCALL FAILED: " << #cond << " = " << ret); \
        }                                                            \
    } while (0)

#ifdef NDEBUG
#define ASSERT(...)
#else
#define ASSERT(cond, info)                                      \
    do {                                                        \
        auto ret = (cond);                                      \
        if (!ret) {                                             \
            PANIC("ASSERT FAILED: " << #cond << " - " << info); \
        }                                                       \
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
        : _msg(std::string("Exception: ") + msg)
        , _bt(new Backtrace()) {}

    virtual ~Exception() throw() {}

    virtual const char* what() const throw()
    {
        return _msg.c_str();
    }

    friend std::ostream& operator<<(std::ostream& os, const Exception& e)
    {
        return os << e._msg << " " << *e._bt;
    }

private:
    const std::string _msg;
    // using shared_ptr to hold the backtrace in order to avoid copying it when the exception is passed by value
    const std::shared_ptr<Backtrace> _bt;
};

static inline std::string
LOG_PREFIX()
{
    using namespace std::chrono;
    auto now = system_clock::now();
    auto now_time = system_clock::to_time_t(now);
    auto now_micros = duration_cast<microseconds>(now.time_since_epoch());
    struct tm now_tm;
    localtime_r(&now_time, &now_tm);
    return XSTR()
        << std::put_time(&now_tm, "%Y-%m-%d %T")
        << "." << std::setfill('0') << std::setw(6) << (now_micros.count() % 1000000)
        << " [PID-" << getpid() << "/TID-" << get_current_tid() << "] ";
}

} // namespace noobaa
