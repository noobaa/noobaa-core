#include "object_chunker.h"
#include "buf.h"
#include "crypto.h"

v8::Persistent<v8::Function> ObjectChunker::_ctor;

void
ObjectChunker::setup(v8::Handle<v8::Object> exports)
{
    auto name = "ObjectChunker";
    auto tpl(NanNew<v8::FunctionTemplate>(ObjectChunker::new_instance));
    tpl->SetClassName(NanNew(name));
    tpl->InstanceTemplate()->SetInternalFieldCount(1);
    NODE_SET_PROTOTYPE_METHOD(tpl, "push", ObjectChunker::push);
    NODE_SET_PROTOTYPE_METHOD(tpl, "flush", ObjectChunker::flush);
    NanAssignPersistent(_ctor, tpl->GetFunction());
    exports->Set(NanNew(name), _ctor);
}

NAN_METHOD(ObjectChunker::new_instance)
{
    NanScope();
    if (!args.IsConstructCall()) {
        // Invoked as plain function call, turn into construct 'new' call.
        NanReturnValue(_ctor->NewInstance());
    } else {
        ObjectChunker* obj = new ObjectChunker();
        obj->Wrap(args.This());
        args.This()->Set(NanNew("tpool"), args[0]);
        NanReturnValue(args.This());
    }
}

ObjectChunker::GF
ObjectChunker::_gf(
    // 20u /* degree */, 0x9u /* poly */
    // 25u /* degree */, 0x9u /* poly */
    // 28u /* degree */, 0x9u /* poly */
    // 31u /* degree */, 0x9u /* poly */
    // 32u /* degree */, 0xafu /* poly */
    63u /* degree */, 0x3u /* poly */
    );

ObjectChunker::RabinHasher
ObjectChunker::_rabin_hasher(
    ObjectChunker::_gf,
    ObjectChunker::WINDOW_LEN);

ObjectChunker::Deduper
ObjectChunker::_deduper(
    ObjectChunker::_rabin_hasher,
    ObjectChunker::WINDOW_LEN,
    ObjectChunker::MIN_CHUNK,
    ObjectChunker::MAX_CHUNK,
    ObjectChunker::AVG_CHUNK_BITS,
    ObjectChunker::AVG_CHUNK_VAL);


class ObjectChunker::Job : public ThreadPool::Job
{
private:
    ObjectChunker& _chunker;
    v8::Persistent<v8::Object> _persistent;
    NanCallbackSharedPtr _callback;
    Buf _buf;
    std::list<Buf> _chunks;
public:
    explicit Job(
        ObjectChunker& chunker,
        v8::Handle<v8::Object> chunker_handle,
        v8::Handle<v8::Value> buf_handle,
        v8::Handle<v8::Value> cb_handle)
        : _chunker(chunker)
        , _callback(new NanCallback(cb_handle.As<v8::Function>()))
        , _buf(node::Buffer::Data(buf_handle), node::Buffer::Length(buf_handle))
    {
        NanAssignPersistent(_persistent, NanNew<v8::Object>());
        _persistent->Set(0, chunker_handle);
        _persistent->Set(1, buf_handle);
    }

    explicit Job(
        ObjectChunker& chunker,
        v8::Handle<v8::Object> chunker_handle,
        v8::Handle<v8::Value> cb_handle)
        : _chunker(chunker)
        , _callback(new NanCallback(cb_handle.As<v8::Function>()))
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

NAN_METHOD(ObjectChunker::push)
{
    NanScope();
    ObjectChunker& self = *Unwrap<ObjectChunker>(args.This());
    ThreadPool& tpool = *Unwrap<ThreadPool>(args.This()->Get(NanNew("tpool"))->ToObject());
    if (args.Length() != 2
        || !node::Buffer::HasInstance(args[0])
        || !args[1]->IsFunction()) {
        return NanThrowError("ObjectChunker::push expected arguments function(buffer,callback)");
    }
    Job* job = new Job(self, args.This(), args[0], args[1]);
    tpool.submit(job);
    NanReturnUndefined();
}

NAN_METHOD(ObjectChunker::flush)
{
    NanScope();
    ObjectChunker& self = *Unwrap<ObjectChunker>(args.This());
    ThreadPool& tpool = *Unwrap<ThreadPool>(args.This()->Get(NanNew("tpool"))->ToObject());
    if (args.Length() != 1
        || !args[0]->IsFunction()) {
        return NanThrowError("ObjectChunker::flush expected arguments function(callback)");
    }
    Job* job = new Job(self, args.This(), args[0]);
    tpool.submit(job);
    NanReturnUndefined();
}
