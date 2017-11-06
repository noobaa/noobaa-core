/* Copyright (C) 2016 NooBaa */
#include "../util/napi.h"

#ifndef WIN32
#include <syslog.h>
#endif

namespace noobaa
{

static void _syslog(const Napi::CallbackInfo& info);
static void _openlog(const Napi::CallbackInfo& info);
static void _closelog(const Napi::CallbackInfo& info);

// openlog requires ident to remain allocated until closelog is called.
// since we pass the string data() to openlog we must not modify this string
// in any way otherwise that pointer might be invalidated.
static std::string _syslog_ident;

void
syslog_napi(Napi::Env env, Napi::Object exports)
{
    exports["syslog"] = Napi::Function::New(env, _syslog);
    exports["openlog"] = Napi::Function::New(env, _openlog);
    exports["closelog"] = Napi::Function::New(env, _closelog);
}

static void
_syslog(const Napi::CallbackInfo& info)
{
#ifndef WIN32
    int priority = info[0].As<Napi::Number>();
    std::string message = info[1].As<Napi::String>().Utf8Value();
    int facility = 0;
    if (info.Length() == 3) {
        std::string facility_str = info[2].As<Napi::String>().Utf8Value();
        if (facility_str == "LOG_LOCAL0") {
            facility = LOG_LOCAL0;
        } else if (facility_str == "LOG_LOCAL1") {
            facility = LOG_LOCAL1;
        } else {
            throw Napi::Error::New(info.Env(), "Syslog facility not supported");
        }
    }
    ::syslog(priority | facility, "%s", message.data());
#endif
}

static void
_openlog(const Napi::CallbackInfo& info)
{
#ifndef WIN32
    if (!_syslog_ident.empty()) {
        throw Napi::Error::New(info.Env(), "Syslog already open, use closelog first");
    }
    _syslog_ident = info[0].As<Napi::String>().Utf8Value();
    // int option = info[1].As<Napi::Number>();
    // int facility = info[2].As<Napi::Number>();
    ::openlog(_syslog_ident.data(), LOG_PID, LOG_LOCAL0);
#endif
}

static void
_closelog(const Napi::CallbackInfo& info)
{
#ifndef WIN32
    ::closelog();
    _syslog_ident.clear();
#endif
}
}
