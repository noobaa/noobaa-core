/* Copyright (C) 2016 NooBaa */
#include "../util/b64.h"
#include "../util/common.h"
#include "../util/napi.h"

namespace noobaa
{

static Napi::Value _b64_encode(const Napi::CallbackInfo& info);
static Napi::Value _b64_decode(const Napi::CallbackInfo& info);

void
b64_napi(Napi::Env env, Napi::Object exports)
{
    exports["b64_encode"] = Napi::Function::New(env, _b64_encode);
    exports["b64_decode"] = Napi::Function::New(env, _b64_decode);
}

static Napi::Value
_b64_encode(const Napi::CallbackInfo& info)
{
    std::string str;
    int input_len = 0;
    const uint8_t* input = 0;

    if (info[0].IsBuffer()) {
        auto buf = info[0].As<Napi::Buffer<uint8_t>>();
        input = buf.Data();
        input_len = buf.Length();

    } else if (info[0].IsString()) {
        str = info[0].As<Napi::String>().Utf8Value();
        input = reinterpret_cast<const uint8_t*>(str.data());
        input_len = str.length();

    } else {
        throw Napi::TypeError::New(info.Env(), "b64_encode: 1st argument should be Buffer|String");
    }

    int output_len = b64_encode_len(input_len);
    std::unique_ptr<uint8_t[]> output(new uint8_t[output_len]);

    int r = b64_encode(input, input_len, output.get());
    if (r < 0) {
        throw Napi::Error::New(info.Env(), XSTR() << "b64_encode: failed " << r);
    }

    return Napi::String::New(info.Env(), reinterpret_cast<char*>(output.get()), r);
}

static Napi::Value
_b64_decode(const Napi::CallbackInfo& info)
{
    std::string str;
    int input_len = 0;
    const uint8_t* input = 0;

    if (info[0].IsBuffer()) {
        auto buf = info[0].As<Napi::Buffer<uint8_t>>();
        input = buf.Data();
        input_len = buf.Length();

    } else if (info[0].IsString()) {
        str = info[0].As<Napi::String>().Utf8Value();
        input = reinterpret_cast<const uint8_t*>(str.data());
        input_len = str.length();

    } else {
        throw Napi::TypeError::New(info.Env(), "b64_decode: 1st argument should be Buffer|String");
    }

    int output_len = b64_decode_len(input_len);
    std::unique_ptr<uint8_t[]> output(new uint8_t[output_len]);

    int r = b64_decode(input, input_len, output.get());
    if (r < 0) {
        throw Napi::Error::New(info.Env(), XSTR() << "b64_decode: failed " << r);
    }

    return Napi::Buffer<uint8_t>::New(info.Env(), output.release(), r);
}
}
