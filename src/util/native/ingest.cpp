#include "ingest.h"
#include "buf.h"
#include "crypto.h"

// statics

v8::Persistent<v8::Function> Ingest::_ctor;

ThreadPool Ingest::_tpool(2);

Ingest::GF
Ingest::_gf(
    // 20u /* degree */, 0x9u /* poly */
    // 25u /* degree */, 0x9u /* poly */
    // 28u /* degree */, 0x9u /* poly */
    // 31u /* degree */, 0x9u /* poly */
    // 32u /* degree */, 0xafu /* poly */
    63u /* degree */, 0x3u /* poly */
    );

Ingest::RabinHasher
Ingest::_rabin_hasher(
    Ingest::_gf,
    Ingest::WINDOW_LEN);

Ingest::Deduper
Ingest::_deduper(
    Ingest::_rabin_hasher,
    Ingest::WINDOW_LEN,
    Ingest::MIN_CHUNK,
    Ingest::MAX_CHUNK,
    Ingest::AVG_CHUNK_BITS,
    Ingest::AVG_CHUNK_VAL);


void
Ingest::setup(v8::Handle<v8::Object> exports)
{
    auto name = "Ingest";
    auto tpl(NanNew<v8::FunctionTemplate>(Ingest::new_instance));
    tpl->SetClassName(NanNew(name));
    tpl->InstanceTemplate()->SetInternalFieldCount(1);
    NODE_SET_PROTOTYPE_METHOD(tpl, "push", Ingest::push);
    NODE_SET_PROTOTYPE_METHOD(tpl, "flush", Ingest::flush);
    NanAssignPersistent(_ctor, tpl->GetFunction());
    exports->Set(NanNew(name), _ctor);
}

NAN_METHOD(Ingest::new_instance)
{
    NanScope();
    if (args.IsConstructCall()) {
        Ingest* obj = new Ingest();
        obj->Wrap(args.This());
        NanReturnValue(args.This());
    } else {
        // Invoked as plain function `Ingest(...)`, turn into construct call.
        v8::Handle<v8::Value>* argv = NULL;
        NanReturnValue(_ctor->NewInstance(0, argv));
    }
}

class Ingest::Job : public ThreadPool::Job
{
private:
    struct Chunk {
        Buf buf;
        std::string sha;
        Chunk(Buf buf_, std::string sha_) : buf(buf_), sha(sha_) {}
    };
    Ingest& _ingest;
    v8::Persistent<v8::Object> _persistent_ingest;
    v8::Persistent<v8::Value> _persistent_buf;
    NanCallbackSharedPtr _callback;
    const char* const _data;
    const int _len;
    std::list<Chunk> _chunks;

public:

    explicit Job(
        Ingest& ingest,
        v8::Handle<v8::Object> ingest_handle,
        v8::Handle<v8::Value> buf_handle,
        v8::Handle<v8::Value> cb_handle)
        : _ingest(ingest)
        , _callback(new NanCallback(cb_handle.As<v8::Function>()))
        , _data(node::Buffer::Data(buf_handle))
        , _len(node::Buffer::Length(buf_handle))
    {
        NanAssignPersistent(_persistent_ingest, ingest_handle);
        NanAssignPersistent(_persistent_buf, buf_handle);
    }

    explicit Job(
        Ingest& ingest,
        v8::Handle<v8::Object> ingest_handle,
        v8::Handle<v8::Value> cb_handle)
        : _ingest(ingest)
        , _callback(new NanCallback(cb_handle.As<v8::Function>()))
        , _data(0)
        , _len(0)
    {
        NanAssignPersistent(_persistent_ingest, ingest_handle);
    }

    virtual ~Job()
    {
        if (!_persistent_ingest.IsEmpty() && _persistent_ingest.IsNearDeath()) {
            NanDisposePersistent(_persistent_ingest);
            _persistent_ingest.Clear();
        }
        if (!_persistent_buf.IsEmpty() && _persistent_buf.IsNearDeath()) {
            NanDisposePersistent(_persistent_buf);
            _persistent_buf.Clear();
        }
    }

    virtual void run() override
    {
        // std::cout << "Ingest::Job run " << std::dec << _len << std::endl;
        if (_data) {
            Buf buf(_data, _len);
            _ingest._chunker.push(buf);
        } else {
            _ingest._chunker.flush();
        }

        while (_ingest._chunker.has_chunks()) {
            // std::cout << "Ingest::Job chunk " << std::dec << _len << std::endl;
            Buf chunk(_ingest._chunker.pop_chunk());
            Buf key(32);
            memset(key.data(), 0, key.length());
            Buf iv(0);
            Buf encrypted = Crypto::encrypt(chunk, key, iv, "aes-256-cbc");
            std::string sha = Crypto::digest(encrypted, "sha256");
            Chunk c(encrypted, sha);
            _chunks.push_back(c);
        }
    }

    virtual void done() override
    {
        int len = _chunks.size();
        v8::Handle<v8::Array> arr(NanNew<v8::Array>(len));
        for (int i=0; i<len; ++i) {
            Chunk chunk = _chunks.front();
            _chunks.pop_front();
            v8::Handle<v8::Object> obj(NanNew<v8::Object>());
            v8::Handle<v8::Object> buffer(NanNewBufferHandle(
                reinterpret_cast<char*>(chunk.buf.data()), chunk.buf.length()));
            obj->Set(NanNew("chunk"), buffer);
            obj->Set(NanNew("sha"), NanNew(chunk.sha));
            arr->Set(i, obj);
            // std::cout << "Ingest::Job done " << chunk.sha << std::endl;
        }
        v8::Handle<v8::Value> argv[] = { NanUndefined(), arr };
        _callback->Call(2, argv);
        delete this;
    }
};

NAN_METHOD(Ingest::push)
{
    NanScope();

    Ingest* self = Unwrap<Ingest>(args.This());
    if (args.Length() != 2
        || !node::Buffer::HasInstance(args[0])
        || !args[1]->IsFunction()) {
        return NanThrowError("Ingest::push expected arguments function(buffer,callback)");
    }

    Job* job = new Job(*self, args.This(), args[0], args[1]);
    // _tpool.submit(job);
    job->run();
    job->done();

    NanReturnUndefined();
}

NAN_METHOD(Ingest::flush)
{
    NanScope();

    Ingest* self = Unwrap<Ingest>(args.This());
    if (args.Length() != 1
        || !args[0]->IsFunction()) {
        return NanThrowError("Ingest::flush expected arguments function(callback)");
    }

    Job* job = new Job(*self, args.This(), args[0]);
    // _tpool.submit(job);
    job->run();
    job->done();

    NanReturnUndefined();
}
