#include "dedup_chunker.h"
#include "buf.h"
#include "crypto.h"

v8::Persistent<v8::Function> DedupChunker::_ctor;

void
DedupChunker::setup(v8::Handle<v8::Object> exports)
{
    auto name = "DedupChunker";
    auto tpl(NanNew<v8::FunctionTemplate>(DedupChunker::new_instance));
    tpl->SetClassName(NanNew(name));
    tpl->InstanceTemplate()->SetInternalFieldCount(1);
    NODE_SET_PROTOTYPE_METHOD(tpl, "push", DedupChunker::push);
    NODE_SET_PROTOTYPE_METHOD(tpl, "flush", DedupChunker::flush);
    NanAssignPersistent(_ctor, tpl->GetFunction());
    exports->Set(NanNew(name), _ctor);
}

NAN_METHOD(DedupChunker::new_instance)
{
    NanScope();
    NAN_MAKE_CTOR_CALL(_ctor);
    v8::Local<v8::Object> self = args.This();
    v8::Local<v8::Object> options = args[0]->ToObject();
    DedupChunker* chunker = new DedupChunker();
    chunker->Wrap(self);
    NAN_COPY_OPTIONS_TO_WRAPPER(self, options);
    NanReturnValue(self);
}

DedupChunker::GF
DedupChunker::_gf(
    // 20u /* degree */, 0x9u /* poly */
    // 25u /* degree */, 0x9u /* poly */
    // 28u /* degree */, 0x9u /* poly */
    // 31u /* degree */, 0x9u /* poly */
    // 32u /* degree */, 0xafu /* poly */
    63u /* degree */, 0x3u /* poly */
    );

DedupChunker::RabinHasher
DedupChunker::_rabin_hasher(
    DedupChunker::_gf,
    DedupChunker::WINDOW_LEN);

DedupChunker::Deduper
DedupChunker::_deduper(
    DedupChunker::_rabin_hasher,
    DedupChunker::WINDOW_LEN,
    DedupChunker::MIN_CHUNK,
    DedupChunker::MAX_CHUNK,
    DedupChunker::AVG_CHUNK_BITS,
    DedupChunker::AVG_CHUNK_VAL);


class DedupChunker::Job : public ThreadPool::Job
{
private:
    DedupChunker& _chunker;
    v8::Persistent<v8::Object> _persistent;
    NanCallbackSharedPtr _callback;
    Buf _buf;
    std::list<Buf> _chunks;
public:
    explicit Job(
        DedupChunker& chunker,
        v8::Handle<v8::Object> chunker_handle,
        v8::Handle<v8::Value> buf_handle,
        NanCallbackSharedPtr callback)
        : _chunker(chunker)
        , _callback(callback)
        , _buf(node::Buffer::Data(buf_handle), node::Buffer::Length(buf_handle))
    {
        NanAssignPersistent(_persistent, NanNew<v8::Object>());
        _persistent->Set(0, chunker_handle);
        _persistent->Set(1, buf_handle);
    }

    explicit Job(
        DedupChunker& chunker,
        v8::Handle<v8::Object> chunker_handle,
        NanCallbackSharedPtr callback)
        : _chunker(chunker)
        , _callback(callback)
    {
        NanAssignPersistent(_persistent, NanNew<v8::Object>());
        _persistent->Set(0, chunker_handle);
    }

    virtual ~Job()
    {
        NanDisposePersistent(_persistent);
    }

    virtual void run() override
    {
        if (!_buf.data()) {
            // just flush
            process_chunk();
            return;
        }

        const uint8_t* datap = _buf.data();
        int len = _buf.length();

        while (len > 0) {
            int offset = _chunker._dedup_window.push(datap, len);
            if (offset) {
                // offset!=0 means we got chunk boundary
                // for the last slice we don't copy it because process_chunk will copy all slices.
                Buf last_slice(datap, offset);
                _chunker._chunk_slices.push_back(last_slice);
                _chunker._chunk_len += last_slice.length();
                process_chunk();
                datap += offset;
                len -= offset;
            } else {
                // offset==0 means no chunk boundary
                // we must make a copy of the slice buffer here because we need to keep
                // it till the next job and the nodejs buffer handle is only attached
                // to the current job.
                Buf slice(len);
                memcpy(slice.data(), datap, len);
                _chunker._chunk_slices.push_back(slice);
                _chunker._chunk_len += slice.length();
                datap += len;
                len = 0;
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

    virtual void done() override
    {
        NanScope();
        int len = _chunks.size();
        v8::Local<v8::Array> arr(NanNew<v8::Array>(len));
        for (int i=0; i<len; ++i) {
            Buf chunk = _chunks.front();
            _chunks.pop_front();
            // TODO reduce mem copy with NanUseBuffer
            arr->Set(i, NanNewBufferHandle(chunk.cdata(), chunk.length()));
        }
        v8::Local<v8::Value> argv[] = { NanUndefined(), arr };
        _callback->Call(2, argv);
        delete this;
    }
};

NAN_METHOD(DedupChunker::push)
{
    NanScope();
    DedupChunker& self = *Unwrap<DedupChunker>(args.This());
    ThreadPool& tpool = *Unwrap<ThreadPool>(args.This()->Get(NanNew("tpool"))->ToObject());
    if (args.Length() != 2
        || !node::Buffer::HasInstance(args[0])
        || !args[1]->IsFunction()) {
        return NanThrowError("DedupChunker::push expected arguments function(buffer,callback)");
    }
    NanCallbackSharedPtr callback(new NanCallback(args[1].As<v8::Function>()));
    Job* job = new Job(self, args.This(), args[0], callback);
    tpool.submit(job);
    NanReturnUndefined();
}

NAN_METHOD(DedupChunker::flush)
{
    NanScope();
    v8::Local<v8::Object> self = args.This();
    DedupChunker& chunker = *Unwrap<DedupChunker>(self);
    ThreadPool& tpool = *Unwrap<ThreadPool>(self->Get(NanNew("tpool"))->ToObject());
    if (args.Length() != 1
        || !args[0]->IsFunction()) {
        return NanThrowError("DedupChunker::flush expected arguments function(callback)");
    }
    NanCallbackSharedPtr callback(new NanCallback(args[0].As<v8::Function>()));
    Job* job = new Job(chunker, self, callback);
    tpool.submit(job);
    NanReturnUndefined();
}
