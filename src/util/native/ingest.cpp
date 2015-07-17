#include "ingest.h"
#include "buf.h"
#include "crypto.h"

v8::Persistent<v8::Function> Ingest::_ctor;

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
        args.This()->Set(NanNew("tpool"), args[0]);
        NanReturnValue(args.This());
    } else {
        // Invoked as plain function call, turn into construct 'new' call.
        v8::Handle<v8::Value> argv[] = { args[0] };
        NanReturnValue(_ctor->NewInstance(1, argv));
    }
}

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


class Ingest::Job
    : public ThreadPool::Job
    , public Ingest::Deduper::ChunkHandler
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
    Ingest& _ingest;
    ThreadPool& _tpool;
    v8::Persistent<v8::Object> _persistent_ingest;
    v8::Persistent<v8::Value> _persistent_buf;
    NanCallbackSharedPtr _callback;
    const char* const _data;
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
            // std::cout << "Ingest::Job chunk " << std::dec << _chunk.length() << std::endl;
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
        Ingest& ingest,
        ThreadPool& tpool,
        v8::Handle<v8::Object> ingest_handle,
        v8::Handle<v8::Value> buf_handle,
        v8::Handle<v8::Value> cb_handle)
        : _ingest(ingest)
        , _tpool(tpool)
        , _callback(new NanCallback(cb_handle.As<v8::Function>()))
        , _data(node::Buffer::Data(buf_handle))
        , _len(node::Buffer::Length(buf_handle))
    {
        NanAssignPersistent(_persistent_ingest, ingest_handle);
        NanAssignPersistent(_persistent_buf, buf_handle);
    }

    explicit Job(
        Ingest& ingest,
        ThreadPool& tpool,
        v8::Handle<v8::Object> ingest_handle,
        v8::Handle<v8::Value> cb_handle)
        : _ingest(ingest)
        , _tpool(tpool)
        , _callback(new NanCallback(cb_handle.As<v8::Function>()))
        , _data(0)
        , _len(0)
    {
        NanAssignPersistent(_persistent_ingest, ingest_handle);
    }

    virtual ~Job()
    {
        if (_persistent_ingest.IsNearDeath()) {
            NanDisposePersistent(_persistent_ingest);
        }
        if (_persistent_buf.IsNearDeath()) {
            NanDisposePersistent(_persistent_buf);
        }
    }

    virtual void run() override
    {
        // std::cout << "Ingest::Job run " << std::dec << _len << std::endl;
        if (_data) {
            Buf buf(_data, _len);
            _ingest._chunker.push(buf, *this);
        } else {
            _ingest._chunker.flush(*this);
        }
    }

    virtual void handle_chunk(Buf chunk) override
    {
        // SubJob* subjob = new SubJob(chunk, _callback);
        //  _tpool.submit(subjob);

        // std::cout << "Ingest::Job chunk " << std::dec << chunk.length() << std::endl;
        Buf sha = Crypto::digest(chunk, "sha256");
        // convergent encryption - key is the content hash
        Buf key = sha;
        // IV is just zeros since the key is unique then IV is not needed
        Buf iv(12);
        RAND_bytes(iv.data(), iv.length());
        Buf encrypted = Crypto::encrypt(chunk, key, iv, "aes-256-gcm");
        Chunk c(encrypted, sha.hex());
        _chunks.push_back(c);
    }

    virtual void done() override
    {
        NanScope();
        int len = _chunks.size();
        // std::cout << "Ingest::Job done " << len << std::endl;
        v8::Local<v8::Array> arr(NanNew<v8::Array>(len));
        for (int i=0; i<len; ++i) {
            Chunk chunk = _chunks.front();
            _chunks.pop_front();
            v8::Local<v8::Object> obj(NanNew<v8::Object>());
            obj->Set(NanNew("chunk"), NanNewBufferHandle(
                         reinterpret_cast<char*>(chunk.buf.data()), chunk.buf.length()));
            obj->Set(NanNew("sha"), NanNew(chunk.sha));
            arr->Set(i, obj);
            // std::cout << "Ingest::Job done " << chunk.buf.length() << " SHA " << chunk.sha << std::endl;
        }
        v8::Local<v8::Value> argv[] = { NanUndefined(), arr };
        _callback->Call(2, argv);
        delete this;
        // scope.Close(NanNew("")); // TODO needed??
    }
};

NAN_METHOD(Ingest::push)
{
    NanScope();

    Ingest& self = *Unwrap<Ingest>(args.This());
    ThreadPool& tpool = *Unwrap<ThreadPool>(args.This()->Get(NanNew("tpool"))->ToObject());
    if (args.Length() != 2
        || !node::Buffer::HasInstance(args[0])
        || !args[1]->IsFunction()) {
        return NanThrowError("Ingest::push expected arguments function(buffer,callback)");
    }

    Job* job = new Job(self, tpool, args.This(), args[0], args[1]);
    tpool.submit(job);

    NanReturnUndefined();
}

NAN_METHOD(Ingest::flush)
{
    NanScope();

    Ingest& self = *Unwrap<Ingest>(args.This());
    ThreadPool& tpool = *Unwrap<ThreadPool>(args.This()->Get(NanNew("tpool"))->ToObject());
    if (args.Length() != 1
        || !args[0]->IsFunction()) {
        return NanThrowError("Ingest::flush expected arguments function(callback)");
    }

    Job* job = new Job(self, tpool, args.This(), args[0]);
    tpool.submit(job);

    NanReturnUndefined();
}
