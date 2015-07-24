#include "object_decoder.h"
#include "buf.h"
#include "crypto.h"
#include "tpool.h"

v8::Persistent<v8::Function> ObjectDecoder::_ctor;

void
ObjectDecoder::setup(v8::Handle<v8::Object> exports)
{
    auto name = "ObjectDecoder";
    auto tpl(NanNew<v8::FunctionTemplate>(ObjectDecoder::new_instance));
    tpl->SetClassName(NanNew(name));
    tpl->InstanceTemplate()->SetInternalFieldCount(1);
    NODE_SET_PROTOTYPE_METHOD(tpl, "push", ObjectDecoder::push);
    NanAssignPersistent(_ctor, tpl->GetFunction());
    exports->Set(NanNew(name), _ctor);
}

NAN_METHOD(ObjectDecoder::new_instance)
{
    NanScope();
    if (!args.IsConstructCall()) {
        // Invoked as plain function call, turn into construct 'new' call.
        NanReturnValue(_ctor->NewInstance());
    } else {
        ObjectDecoder* obj = new ObjectDecoder();
        obj->Wrap(args.This());
        args.This()->Set(NanNew("tpool"), args[0]);
        NanReturnValue(args.This());
    }
}

class ObjectDecoder::Job : public ThreadPool::Job
{
private:
    ObjectDecoder& _decoder;
    v8::Persistent<v8::Object> _persistent;
    NanCallbackSharedPtr _callback;
public:
    explicit Job(
        ObjectDecoder& decoder,
        v8::Handle<v8::Object> decoder_handle,
        v8::Handle<v8::Value> chunk_handle,
        v8::Handle<v8::Value> cb_handle)
        : _decoder(decoder)
        , _callback(new NanCallback(cb_handle.As<v8::Function>()))
    {
        NanAssignPersistent(_persistent, NanNew<v8::Object>());
        _persistent->Set(0, decoder_handle);
        _persistent->Set(1, chunk_handle);
    }

    virtual ~Job()
    {
        NanDisposePersistent(_persistent);
    }

    virtual void run() override
    {
    }

    virtual void done() override
    {
        NanScope();
        v8::Local<v8::Value> argv[] = { NanUndefined(), _persistent->Get(1) };
        _callback->Call(2, argv);
        delete this;
    }
};

NAN_METHOD(ObjectDecoder::push)
{
    NanScope();
    ObjectDecoder& self = *Unwrap<ObjectDecoder>(args.This());
    ThreadPool& tpool = *Unwrap<ThreadPool>(args.This()->Get(NanNew("tpool"))->ToObject());
    if (args.Length() != 2
        || !args[0]->IsObject()
        || !args[1]->IsFunction()) {
        return NanThrowError("ObjectDecoder::push expected arguments function(chunk,callback)");
    }
    Job* job = new Job(self, args.This(), args[0], args[1]);
    tpool.submit(job);
    NanReturnUndefined();
}
