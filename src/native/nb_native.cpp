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
void cuobj_server_napi(Napi::Env env, Napi::Object exports);
void cuobj_client_napi(Napi::Env env, Napi::Object exports);
void cuda_napi(Napi::Env env, Napi::Object exports);

#if BUILD_S3SELECT
void s3select_napi(Napi::Env env, Napi::Object exports);
#endif

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
    cuobj_server_napi(env, exports);
    cuobj_client_napi(env, exports);
    cuda_napi(env, exports);

#if BUILD_S3SELECT
    s3select_napi(env, exports);
#endif

    return exports;
}

NODE_API_MODULE(nb_native, nb_native_napi)
} // namespace noobaa
