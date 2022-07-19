/* Copyright (C) 2016 NooBaa */
#include "../util/napi.h"
#include "../util/common.h"

#include <stdlib.h>
#include <uv.h>
#include <dlfcn.h>
#include <malloc.h>

namespace noobaa
{

DBG_INIT(0);

static void (*malloc_stats_print)
(
    void (*write_cb) (void *, const char *), 
    void *cbopaque, 
    const char *opts
) = 0;

static void _print_malloc_stats(const Napi::CallbackInfo& info);
static void _print_jemalloc_stats(const Napi::CallbackInfo& info);

void
malloc_napi(Napi::Env env, Napi::Object exports)
{
    auto exports_malloc = Napi::Object::New(env);
    uv_lib_t *lib = (uv_lib_t*) malloc(sizeof(uv_lib_t));
    lib->handle = RTLD_DEFAULT;
    lib->errmsg = NULL;
    if (uv_dlsym(lib, "malloc_stats_print", (void **) &malloc_stats_print)) {
        DBG1("Error: " << uv_dlerror(lib));
    }
    if (malloc_stats_print == NULL) {
        exports_malloc["print_stats"] = Napi::Function::New(env, _print_malloc_stats);
    } else {
        exports_malloc["print_stats"] = Napi::Function::New(env, _print_jemalloc_stats);
    }
    exports["malloc"] = exports_malloc;
}

static void
_print_jemalloc_stats(const Napi::CallbackInfo& info)
{
    malloc_stats_print(NULL, NULL, NULL);
}

static void
_print_malloc_stats(const Napi::CallbackInfo& info)
{
    malloc_stats();
}
}
