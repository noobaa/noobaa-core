#include "write_processor.h"
#include "buf.h"
#include "crypto.h"

v8::Persistent<v8::Function> WriteProcessor::_ctor;

void
WriteProcessor::setup(v8::Handle<v8::Object> exports)
{
    auto name = "WriteProcessor";
    auto tpl(NanNew<v8::FunctionTemplate>(WriteProcessor::new_instance));
    tpl->SetClassName(NanNew(name));
    tpl->InstanceTemplate()->SetInternalFieldCount(1);
    NODE_SET_PROTOTYPE_METHOD(tpl, "push", WriteProcessor::push);
    NODE_SET_PROTOTYPE_METHOD(tpl, "flush", WriteProcessor::flush);
    NanAssignPersistent(_ctor, tpl->GetFunction());
    exports->Set(NanNew(name), _ctor);
}

NAN_METHOD(WriteProcessor::new_instance)
{
    NanScope();
    if (args.IsConstructCall()) {
        WriteProcessor* obj = new WriteProcessor();
        obj->Wrap(args.This());
        args.This()->Set(NanNew("tpool"), args[0]);
        NanReturnValue(args.This());
    } else {
        // Invoked as plain function call, turn into construct 'new' call.
        v8::Handle<v8::Value> argv[] = { args[0] };
        NanReturnValue(_ctor->NewInstance(1, argv));
    }
}

WriteProcessor::GF
WriteProcessor::_gf(
    // 20u /* degree */, 0x9u /* poly */
    // 25u /* degree */, 0x9u /* poly */
    // 28u /* degree */, 0x9u /* poly */
    // 31u /* degree */, 0x9u /* poly */
    // 32u /* degree */, 0xafu /* poly */
    63u /* degree */, 0x3u /* poly */
    );

WriteProcessor::RabinHasher
WriteProcessor::_rabin_hasher(
    WriteProcessor::_gf,
    WriteProcessor::WINDOW_LEN);

WriteProcessor::Deduper
WriteProcessor::_deduper(
    WriteProcessor::_rabin_hasher,
    WriteProcessor::WINDOW_LEN,
    WriteProcessor::MIN_CHUNK,
    WriteProcessor::MAX_CHUNK,
    WriteProcessor::AVG_CHUNK_BITS,
    WriteProcessor::AVG_CHUNK_VAL);


class WriteProcessor::Job : public ThreadPool::Job
{
private:
    struct Chunk {
        Buf buf;
        std::string sha;
        Chunk(Buf buf_, std::string sha_)
            : buf(buf_)
            , sha(sha_)
        {
        }
    };
    WriteProcessor& _write_processor;
    ThreadPool& _tpool;
    v8::Persistent<v8::Object> _persistent;
    NanCallbackSharedPtr _callback;
    const uint8_t* _data;
    const int _len;
    std::list<Chunk> _chunks;

    /*
    class SubJob : public ThreadPool::Job
    {
private:
        Buf _chunk;
        NanCallbackSharedPtr _callback;
        Buf _encrypted;
        std::string _sha;
public:
        explicit SubJob(Buf chunk, NanCallbackSharedPtr callback)
            : _chunk(chunk)
            , _callback(callback)
        {
        }
        virtual void run() override
        {
            // std::cout << "WriteProcessor::Job chunk " << std::dec << _chunk.length() << std::endl;
            Buf sha = Crypto::digest(_chunk, "sha256");
            // convergent encryption - key is the content hash
            Buf key = sha;
            // IV is just zeros since the key is unique then IV is not needed
            Buf iv(12);
            RAND_bytes(iv.data(), iv.length());
            _encrypted = Crypto::encrypt(_chunk, key, iv, "aes-256-gcm");
            _sha = sha.hex();
        }
        virtual void done() override
        {
            NanScope();
            v8::Local<v8::Object> obj(NanNew<v8::Object>());
            obj->Set(NanNew("chunk"), NanNewBufferHandle(
                         reinterpret_cast<char*>(_encrypted.data()), _encrypted.length()));
            obj->Set(NanNew("sha"), NanNew(_sha));
            v8::Local<v8::Value> argv[] = { NanUndefined(), obj };
            _callback->Call(2, argv);
            delete this;
        }
    };
    */

public:

    explicit Job(
        WriteProcessor& write_processor,
        ThreadPool& tpool,
        v8::Handle<v8::Object> write_processor_handle,
        v8::Handle<v8::Value> buf_handle,
        v8::Handle<v8::Value> cb_handle)
        : _write_processor(write_processor)
        , _tpool(tpool)
        , _callback(new NanCallback(cb_handle.As<v8::Function>()))
        , _data(reinterpret_cast<const uint8_t*>(node::Buffer::Data(buf_handle)))
        , _len(node::Buffer::Length(buf_handle))
    {
        NanAssignPersistent(_persistent, NanNew<v8::Object>());
        _persistent->Set(0, write_processor_handle);
        _persistent->Set(1, buf_handle);
    }

    explicit Job(
        WriteProcessor& write_processor,
        ThreadPool& tpool,
        v8::Handle<v8::Object> write_processor_handle,
        v8::Handle<v8::Value> cb_handle)
        : _write_processor(write_processor)
        , _tpool(tpool)
        , _callback(new NanCallback(cb_handle.As<v8::Function>()))
        , _data(0)
        , _len(0)
    {
        NanAssignPersistent(_persistent, NanNew<v8::Object>());
        _persistent->Set(0, write_processor_handle);
    }

    virtual ~Job()
    {
        NanDisposePersistent(_persistent);
    }

    virtual void run() override
    {
        if (!_data) {
            // just flush
            process_chunk();
            return;
        }

        const uint8_t* datap = _data;
        int len = _len;

        while (len > 0) {
            int offset = _write_processor._chunker.push(datap, len);
            if (offset) {
                // offset!=0 means we got chunk boundary
                // for the last slice we don't copy it because process_chunk will copy all slices.
                Buf last_slice(datap, offset, false);
                _write_processor._chunk_slices.push_back(last_slice);
                _write_processor._chunk_len += last_slice.length();
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
                _write_processor._chunk_slices.push_back(slice);
                _write_processor._chunk_len += slice.length();
                datap += len;
                len = 0;
            }
        }
    }

    void process_chunk()
    {
        if (_write_processor._chunk_slices.empty()) {
            return;
        }

        // concat the slices to single buffer - copyful
        Buf chunk(
            _write_processor._chunk_len,
            _write_processor._chunk_slices.begin(),
            _write_processor._chunk_slices.end());
        _write_processor._chunk_slices.clear();
        _write_processor._chunk_len = 0;

        Buf sha = Crypto::digest(chunk, "sha256");
        // convergent encryption - key is the content hash
        Buf key = sha;
        // Buf key(16);
        // RAND_bytes(key.data(), key.length());
        // IV is just zeros since the key is unique then IV is not needed
        Buf iv(16);
        // Buf iv(64);
        RAND_bytes(iv.data(), iv.length());
        Buf encrypted = Crypto::encrypt(chunk, key, iv, "aes-256-gcm");
        Chunk c(encrypted, sha.hex());
        _chunks.push_back(c);
    }

    virtual void done() override
    {
        NanScope();
        int len = _chunks.size();
        v8::Local<v8::Array> arr(NanNew<v8::Array>(len));
        for (int i=0; i<len; ++i) {
            Chunk chunk = _chunks.front();
            _chunks.pop_front();
            v8::Local<v8::Object> obj(NanNew<v8::Object>());
            obj->Set(NanNew("buf"), NanNewBufferHandle(
                         reinterpret_cast<char*>(chunk.buf.data()), chunk.buf.length()));
            obj->Set(NanNew("sha"), NanNew(chunk.sha));
            arr->Set(i, obj);
        }
        v8::Local<v8::Value> argv[] = { NanUndefined(), arr };
        _callback->Call(2, argv);
        delete this;
    }
};

NAN_METHOD(WriteProcessor::push)
{
    NanScope();

    WriteProcessor& self = *Unwrap<WriteProcessor>(args.This());
    ThreadPool& tpool = *Unwrap<ThreadPool>(args.This()->Get(NanNew("tpool"))->ToObject());
    if (args.Length() != 2
        || !node::Buffer::HasInstance(args[0])
        || !args[1]->IsFunction()) {
        return NanThrowError("WriteProcessor::push expected arguments function(buffer,callback)");
    }

    Job* job = new Job(self, tpool, args.This(), args[0], args[1]);
    tpool.submit(job);

    NanReturnUndefined();
}

NAN_METHOD(WriteProcessor::flush)
{
    NanScope();

    WriteProcessor& self = *Unwrap<WriteProcessor>(args.This());
    ThreadPool& tpool = *Unwrap<ThreadPool>(args.This()->Get(NanNew("tpool"))->ToObject());
    if (args.Length() != 1
        || !args[0]->IsFunction()) {
        return NanThrowError("WriteProcessor::flush expected arguments function(callback)");
    }

    Job* job = new Job(self, tpool, args.This(), args[0]);
    tpool.submit(job);

    NanReturnUndefined();
}
