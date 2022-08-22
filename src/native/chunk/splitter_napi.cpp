/* Copyright (C) 2016 NooBaa */
#include "../util/napi.h"
#include "splitter.h"
#include <iostream>

namespace noobaa
{

#define SPLITTER_JS_SIGNATURE "function chunk_splitter(state, buffers, callback?)"

static Napi::Value _chunk_splitter(const Napi::CallbackInfo& info);
static Napi::Value _splitter_finish(Napi::Env env, Splitter* splitter);
static Napi::Value _splitter_result(Napi::Env env, Splitter* splitter);
static void _free_splitter(Napi::Env env, Splitter* splitter);

void
splitter_napi(Napi::Env env, Napi::Object exports)
{
    exports["chunk_splitter"] = Napi::Function::New(env, _chunk_splitter);
}

class SplitterWorker : public Napi::AsyncWorker
{
public:
    SplitterWorker(
        Napi::Object state,
        Napi::Array buffers,
        Napi::Function callback,
        Splitter* splitter)
        : Napi::AsyncWorker(callback)
        , _state_ref(Napi::ObjectReference::New(state, 1))
        , _buffers_ref(Napi::ObjectReference::New(buffers, 1))
        , _splitter(splitter)
    {
        nb_bufs_init(&_input);
        const int buffers_len = buffers.Length();
        for (int i = 0; i < buffers_len; ++i) {
            Napi::Value buf_val = buffers[i];
            if (!buf_val.IsBuffer()) {
                nb_bufs_free(&_input);
                throw Napi::TypeError::New(
                    Env(), "Argument 'buffers[i] should be buffer - " SPLITTER_JS_SIGNATURE);
            }
            auto buf = buf_val.As<Napi::Buffer<uint8_t>>();
            nb_bufs_push_shared(&_input, buf.Data(), buf.Length());
        }
    }

    virtual ~SplitterWorker()
    {
        nb_bufs_free(&_input);
    }

    virtual void Execute()
    {
        struct NB_Buf* b = nb_bufs_get(&_input, 0);
        for (int i = 0; i < _input.count; ++i, ++b) {
            _splitter->push(b->data, b->len);
        }
    }

    virtual void OnOK()
    {
        auto result = _splitter_result(Env(), _splitter);
        Callback().MakeCallback(Env().Global(), { Env().Null(), result });
    }

private:
    Napi::ObjectReference _state_ref;
    Napi::ObjectReference _buffers_ref;
    Splitter* _splitter;
    struct NB_Bufs _input;
};

static Napi::Value
_chunk_splitter(const Napi::CallbackInfo& info)
{
    if (!info[0].IsObject()) {
        throw Napi::TypeError::New(
            info.Env(), "Argument 'state' should be Object - " SPLITTER_JS_SIGNATURE);
    }

    auto state = info[0].As<Napi::Object>();
    Napi::Value splitter_val = state["splitter"];
    Napi::External<Splitter> external(info.Env(), splitter_val);
    Splitter* splitter = 0;
    if (!splitter_val.IsUndefined()) splitter = external.Data();

    if (splitter && info.Length() == 1) {
        return _splitter_finish(info.Env(), splitter);
    }

    if (!info[1].IsArray()) {
        throw Napi::TypeError::New(
            info.Env(), "Argument 'buffers' should be Buffer[] - " SPLITTER_JS_SIGNATURE);
    }
    if (!info[2].IsFunction() && !info[2].IsUndefined()) {
        throw Napi::TypeError::New(
            info.Env(),
            "Argument 'callback' should be "
            "Function or undefined "
            "- " SPLITTER_JS_SIGNATURE);
    }

    if (!splitter) {
        const int min_chunk = Napi::Value(state["min_chunk"]).As<Napi::Number>();
        const int max_chunk = Napi::Value(state["max_chunk"]).As<Napi::Number>();
        const int avg_chunk_bits = Napi::Value(state["avg_chunk_bits"]).As<Napi::Number>();
        const bool calc_md5 = Napi::Value(state["calc_md5"]).As<Napi::Boolean>();
        const bool calc_sha256 = Napi::Value(state["calc_sha256"]).As<Napi::Boolean>();
        if (min_chunk <= 0 || max_chunk < min_chunk || avg_chunk_bits < 0) {
            throw Napi::Error::New(info.Env(), "Invalid splitter config");
        }
        splitter = new Splitter(min_chunk, max_chunk, avg_chunk_bits, calc_md5, calc_sha256);
        state["splitter"] = Napi::External<Splitter>::New(info.Env(), splitter, _free_splitter);
    }

    auto buffers = info[1].As<Napi::Array>();

    if (info[2].IsUndefined()) {
        const int buffers_len = buffers.Length();
        for (int i = 0; i < buffers_len; ++i) {
            Napi::Value buf_val = buffers[i];
            if (!buf_val.IsBuffer()) {
                throw Napi::TypeError::New(
                    info.Env(), "Argument 'buffers[i] should be buffer - " SPLITTER_JS_SIGNATURE);
            }
            auto buf = buf_val.As<Napi::Buffer<uint8_t>>();
            splitter->push(buf.Data(), buf.Length());
        }
        return _splitter_result(info.Env(), splitter);

    } else {
        auto callback = info[2].As<Napi::Function>();
        SplitterWorker* worker = new SplitterWorker(state, buffers, callback, splitter);
        worker->Queue();
        return info.Env().Undefined();
    }
}

static Napi::Value
_splitter_finish(Napi::Env env, Splitter* splitter)
{
    uint8_t* md5 = 0;
    uint8_t* sha256 = 0;
    auto res = Napi::Object::New(env);
    if (splitter->calc_md5()) {
        auto md5_buf = Napi::Buffer<uint8_t>::New(env, EVP_MD_size(EVP_md5()));
        md5 = md5_buf.Data();
        res["md5"] = md5_buf;
    }
    if (splitter->calc_sha256()) {
        auto sha256_buf = Napi::Buffer<uint8_t>::New(env, EVP_MD_size(EVP_sha256()));
        sha256 = sha256_buf.Data();
        res["sha256"] = sha256_buf;
    }
    splitter->finish(md5, sha256);
    return res;
}

static Napi::Value
_splitter_result(Napi::Env env, Splitter* splitter)
{
    auto split_points = splitter->extract_points();
    int count = split_points.size();
    auto arr = Napi::Array::New(env, count);
    for (int i = 0; i < count; ++i) {
        arr[i] = Napi::Number::New(env, split_points[i]);
    }
    return arr;
}

static void 
_free_splitter(Napi::Env env, Splitter* splitter)
{
    delete splitter;
}

} // namespace noobaa
