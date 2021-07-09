/* Copyright (C) 2016 NooBaa */
#include "util/napi.h"

namespace noobaa
{

void b64_napi(Napi::Env env, Napi::Object exports);
void ssl_napi(Napi::Env env, Napi::Object exports);
void syslog_napi(Napi::Env env, Napi::Object exports);
void splitter_napi(Napi::Env env, Napi::Object exports);
void chunk_coder_napi(napi_env env, napi_value exports);
void fs_napi(Napi::Env env, Napi::Object exports);
void crypto_napi(Napi::Env env, Napi::Object exports);

Napi::Object
nb_native_napi(Napi::Env env, Napi::Object exports)
{
    b64_napi(env, exports);
    ssl_napi(env, exports);
    syslog_napi(env, exports);
    splitter_napi(env, exports);
    chunk_coder_napi(env, exports);
    fs_napi(env, exports);
    crypto_napi(env, exports);
    return exports;
}

NODE_API_MODULE(nb_native, nb_native_napi)
}
