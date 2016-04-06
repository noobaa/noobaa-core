#include "dedup_chunker.h"
#include "../util/buf.h"
#include "../util/crypto.h"

namespace noobaa {

Nan::Persistent<v8::Function> DedupChunker::_ctor;

NAN_MODULE_INIT(DedupChunker::setup)
{
    auto name = "DedupChunker";
    auto tpl(Nan::New<v8::FunctionTemplate>(DedupChunker::new_instance));
    tpl->SetClassName(NAN_STR(name));
    tpl->InstanceTemplate()->SetInternalFieldCount(1);
    Nan::SetPrototypeMethod(tpl, "push", DedupChunker::push);
    Nan::SetPrototypeMethod(tpl, "flush", DedupChunker::flush);
    auto func = Nan::GetFunction(tpl).ToLocalChecked();
    _ctor.Reset(func);
    NAN_SET(target, name, func);
}

NAN_METHOD(DedupChunker::new_instance)
{
    NAN_MAKE_CTOR_CALL(_ctor);
    v8::Local<v8::Object> self = info.This();
    v8::Local<v8::Object> options = info[0]->ToObject();
    v8::Local<v8::Object> config_obj = info[1]->ToObject();
    DedupConfig* config = NAN_UNWRAP_OBJ(DedupConfig, config_obj);
    DedupChunker* chunker = new DedupChunker(config);
    chunker->Wrap(self);
    chunker->_config_persistent.Reset(config_obj);
    NAN_COPY_OPTIONS_TO_WRAPPER(self, options);
    info.GetReturnValue().Set(self);
}

/**
 *
 *
 * DedupChunker::Worker
 *
 * worker submitted from nodejs thread to threadpool threads
 * for offloading and also to use multiple threads when running multiple streams.
 *
 */
class DedupChunker::Worker : public ThreadPool::Worker
{
private:
    DedupChunker& _chunker;
    Nan::Persistent<v8::Object> _persistent;
    NanCallbackSharedPtr _callback;
    std::list<Buf> _bufs;
    std::list<Buf> _chunks;
public:

    // ctor with data buffer
    explicit Worker(
        DedupChunker& chunker,
        v8::Handle<v8::Object> chunker_handle,
        v8::Handle<v8::Object> buf_or_bufs,
        NanCallbackSharedPtr callback)
        : _chunker(chunker)
        , _callback(callback)
    {
        auto persistent = NAN_NEW_OBJ();
        NAN_SET(persistent, 0, chunker_handle);
        NAN_SET(persistent, 1, buf_or_bufs);
        _persistent.Reset(persistent);

        if (buf_or_bufs->IsArray()) {
            int num_buffers = buf_or_bufs.As<v8::Array>()->Length();
            for (int i=0; i<num_buffers; ++i) {
                auto node_buf = NAN_GET_OBJ(buf_or_bufs, i);
                Buf buf(node::Buffer::Data(node_buf), node::Buffer::Length(node_buf));
                _bufs.push_back(buf);
            }
        } else {
            Buf buf(node::Buffer::Data(buf_or_bufs), node::Buffer::Length(buf_or_bufs));
            _bufs.push_back(buf);
        }
    }

    // ctor for flush (without data buffer)
    explicit Worker(
        DedupChunker& chunker,
        v8::Handle<v8::Object> chunker_handle,
        NanCallbackSharedPtr callback)
        : _chunker(chunker)
        , _callback(callback)
    {
        auto persistent = NAN_NEW_OBJ();
        NAN_SET(persistent, 0, chunker_handle);
        _persistent.Reset(persistent);
    }

    virtual ~Worker()
    {
        _persistent.Reset();
    }

    virtual void work() //override (override requires C++11, N/A before gcc-4.7)
    {
        if (_bufs.empty()) {
            // just flush
            process_chunk();
            return;
        }

        while (!_bufs.empty()) {
            Buf buf = _bufs.front();
            _bufs.pop_front();
            int len = buf.length();
            int pos = 0;

            while (len > 0) {
                int offset = _chunker._dedup_window.push(buf.data() + pos, len);
                if (offset) {
                    // offset!=0 means we got chunk boundary
                    // for the last slice we don't copy it because
                    // process_chunk will copy all slices.
                    Buf shared_slice(buf, pos, offset);
                    _chunker._chunk_slices.push_back(shared_slice);
                    _chunker._chunk_len += offset;
                    process_chunk();
                    pos += offset;
                    len -= offset;
                } else {
                    // offset==0 means no chunk boundary
                    // we must make a copy of the slice buffer here because we need to keep
                    // it till the next worker and the nodejs buffer handle is only attached
                    // to the current worker.
                    Buf copy_slice(len);
                    memcpy(copy_slice.data(), buf.data() + pos, len);
                    _chunker._chunk_slices.push_back(copy_slice);
                    _chunker._chunk_len += len;
                    pos += len;
                    len = 0;
                }
            }
        }
    }

    void process_chunk()
    {
        if (_chunker._chunk_slices.empty()) {
            return;
        }
        // concat the slices to single buffer - copyful
        Buf chunk(
            _chunker._chunk_len,
            _chunker._chunk_slices.begin(),
            _chunker._chunk_slices.end());
        _chunker._chunk_slices.clear();
        _chunker._chunk_len = 0;
        _chunks.push_back(chunk);
    }

    virtual void after_work() //override (override requires C++11, N/A before gcc-4.7)
    {
        Nan::HandleScope scope;
        int len = _chunks.size();
        auto arr = NAN_NEW_ARR(len);
        for (int i=0; i<len; ++i) {
            Buf chunk = _chunks.front();
            _chunks.pop_front();
            // we optimize to avoid another memory copy -
            // by detaching the chunk buffer memory and pass it to the node.js buffer
            // which is safe since we know that it was constructed in process_chunk
            // and is not sliced (otherwise delete would be unaligned),
            // and uniquely pointed here.
            NAN_SET_BUF_DETACH(arr, i, chunk);
        }
        v8::Local<v8::Value> argv[] = { Nan::Undefined(), arr };
        _callback->Call(2, argv);
        delete this;
    }
};

NAN_METHOD(DedupChunker::push)
{
    if (info.Length() != 2
        || (!node::Buffer::HasInstance(info[0]) && !info[0]->IsArray())
        || !info[1]->IsFunction()) {
        return Nan::ThrowError("DedupChunker::push expected arguments function(buf_or_bufs,callback)");
    }
    v8::Local<v8::Object> self = info.This();
    DedupChunker& chunker = *NAN_UNWRAP_THIS(DedupChunker);
    ThreadPool& tpool = *NAN_GET_UNWRAP(ThreadPool, self, "tpool");
    v8::Local<v8::Object> buf_or_bufs = info[0]->ToObject();
    NanCallbackSharedPtr callback(new Nan::Callback(info[1].As<v8::Function>()));
    Worker* worker = new Worker(chunker, self, buf_or_bufs, callback);
    tpool.submit(worker);
    NAN_RETURN(Nan::Undefined());
}

NAN_METHOD(DedupChunker::flush)
{
    if (info.Length() != 1 || !info[0]->IsFunction()) {
        return Nan::ThrowError("DedupChunker::flush expected arguments function(callback)");
    }
    v8::Local<v8::Object> self = info.This();
    DedupChunker& chunker = *NAN_UNWRAP_THIS(DedupChunker);
    ThreadPool& tpool = *NAN_GET_UNWRAP(ThreadPool, self, "tpool");
    NanCallbackSharedPtr callback(new Nan::Callback(info[0].As<v8::Function>()));
    Worker* worker = new Worker(chunker, self, callback);
    tpool.submit(worker);
    NAN_RETURN(Nan::Undefined());
}

} // namespace noobaa
