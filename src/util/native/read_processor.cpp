#include "read_processor.h"
#include "buf.h"
#include "crypto.h"
#include "tpool.h"

v8::Persistent<v8::Function> ReadProcessor::_ctor;

void
ReadProcessor::setup(v8::Handle<v8::Object> exports)
{
    auto name = "ReadProcessor";
    auto tpl(NanNew<v8::FunctionTemplate>(ReadProcessor::new_instance));
    tpl->SetClassName(NanNew(name));
    tpl->InstanceTemplate()->SetInternalFieldCount(1);
    NODE_SET_PROTOTYPE_METHOD(tpl, "push", ReadProcessor::push);
    NODE_SET_PROTOTYPE_METHOD(tpl, "flush", ReadProcessor::flush);
    NanAssignPersistent(_ctor, tpl->GetFunction());
    exports->Set(NanNew(name), _ctor);
}

NAN_METHOD(ReadProcessor::new_instance)
{
    NanScope();
    if (args.IsConstructCall()) {
        ReadProcessor* obj = new ReadProcessor();
        obj->Wrap(args.This());
        args.This()->Set(NanNew("tpool"), args[0]);
        NanReturnValue(args.This());
    } else {
        // Invoked as plain function call, turn into construct 'new' call.
        v8::Handle<v8::Value> argv[] = { args[0] };
        NanReturnValue(_ctor->NewInstance(1, argv));
    }
}

class ReadProcessor::Job
    : public ThreadPool::Job
{
private:
    ReadProcessor& _read_processor;
    v8::Persistent<v8::Object> _persistent;
    NanCallbackSharedPtr _callback;
    const char* const _data;
    const int _len;
    std::string _sha;

public:

    explicit Job(
        ReadProcessor& read_processor,
        v8::Handle<v8::Object> read_processor_handle,
        v8::Handle<v8::Value> buf_handle,
        v8::Handle<v8::Value> cb_handle)
        : _read_processor(read_processor)
        , _callback(new NanCallback(cb_handle.As<v8::Function>()))
        , _data(node::Buffer::Data(buf_handle))
        , _len(node::Buffer::Length(buf_handle))
    {
        NanAssignPersistent(_persistent, NanNew<v8::Object>());
        _persistent->Set(0, read_processor_handle);
        _persistent->Set(1, buf_handle);
    }

    explicit Job(
        ReadProcessor& read_processor,
        v8::Handle<v8::Object> read_processor_handle,
        v8::Handle<v8::Value> cb_handle)
        : _read_processor(read_processor)
        , _callback(new NanCallback(cb_handle.As<v8::Function>()))
        , _data(0)
        , _len(0)
    {
        NanAssignPersistent(_persistent, NanNew<v8::Object>());
        _persistent->Set(0, read_processor_handle);
    }

    virtual ~Job()
    {
        NanDisposePersistent(_persistent);
    }

    virtual void run() override
    {
        if (_data) {
            Buf buf(_data, _len, false);
            Buf sha = Crypto::digest(buf, "sha256");
            _sha = sha.hex();
        }
    }

    virtual void done() override
    {
        NanScope();
        v8::Local<v8::Value> res = NanUndefined();
        if (_data) {
            v8::Local<v8::Object> obj(NanNew<v8::Object>());
            obj->Set(NanNew("buf"), NanNewBufferHandle(
                         const_cast<char*>(_data), _len));
            obj->Set(NanNew("sha"), NanNew(_sha));
            res = obj;
        }
        v8::Local<v8::Value> argv[] = { NanUndefined(), res };
        _callback->Call(2, argv);
        delete this;
    }
};

NAN_METHOD(ReadProcessor::push)
{
    NanScope();

    ReadProcessor& self = *Unwrap<ReadProcessor>(args.This());
    ThreadPool& tpool = *Unwrap<ThreadPool>(args.This()->Get(NanNew("tpool"))->ToObject());
    if (args.Length() != 2
        || !node::Buffer::HasInstance(args[0])
        || !args[1]->IsFunction()) {
        return NanThrowError("ReadProcessor::push expected arguments function(buffer,callback)");
    }

    Job* job = new Job(self, args.This(), args[0], args[1]);
    tpool.submit(job);

    NanReturnUndefined();
}

NAN_METHOD(ReadProcessor::flush)
{
    NanScope();

    ReadProcessor& self = *Unwrap<ReadProcessor>(args.This());
    ThreadPool& tpool = *Unwrap<ThreadPool>(args.This()->Get(NanNew("tpool"))->ToObject());
    if (args.Length() != 1
        || !args[0]->IsFunction()) {
        return NanThrowError("ReadProcessor::flush expected arguments function(callback)");
    }

    Job* job = new Job(self, args.This(), args[0]);
    tpool.submit(job);

    NanReturnUndefined();
}
