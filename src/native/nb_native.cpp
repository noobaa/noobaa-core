/* Copyright (C) 2016 NooBaa */
#include "util/napi.h"

namespace noobaa
{

void b64_napi(Napi::Env env, Napi::Object exports);
void ssl_napi(napi_env env, napi_value exports);
void syslog_napi(Napi::Env env, Napi::Object exports);
void splitter_napi(Napi::Env env, Napi::Object exports);
void chunk_coder_napi(napi_env env, napi_value exports);

void
nb_native_napi(Napi::Env env, Napi::Object exports, Napi::Object module_deprecated)
{
    b64_napi(env, exports);
    ssl_napi(env, exports);
    syslog_napi(env, exports);
    splitter_napi(env, exports);
    chunk_coder_napi(env, exports);
}

NODE_API_MODULE(nb_native, nb_native_napi)
}
