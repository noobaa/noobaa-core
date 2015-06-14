#include "nudp.h"

v8::Persistent<v8::Function> Nudp::_ctor;

void
Nudp::initialize(HOBJ exports)
{
    v8::Local<v8::FunctionTemplate> t(v8::FunctionTemplate::New(Nudp::new_instance));
    t->SetClassName(v8::String::NewSymbol("Nudp"));
    t->InstanceTemplate()->SetInternalFieldCount(1);
    NODE_SET_PROTOTYPE_METHOD(t, "send", Nudp::_send);

    // save ctor persistent handle to be used by new_instance
    _ctor = v8::Persistent<v8::Function>::New(t->GetFunction());
    exports->Set(v8::String::NewSymbol("Nudp"), _ctor);
}

HVAL
Nudp::new_instance(const v8::Arguments& args)
{
    v8::HandleScope scope;
    if (args.IsConstructCall()) {
        // Invoked as constructor: `new Nudp(...)`
        // double value = args[0]->IsUndefined() ? 0 : args[0]->NumberValue();
        Nudp* obj = new Nudp();
        obj->Wrap(args.This());
        return args.This();
    } else {
        // Invoked as plain function `Nudp(...)`, turn into construct call.
        const int argc = 1;
        v8::Local<v8::Value> argv[argc] = { args[0] };
        return scope.Close(_ctor->NewInstance(argc, argv));
    }
}

Nudp::Nudp()
{
    std::cout << "CTOR" << std::endl;
}

Nudp::~Nudp()
{
    std::cout << "DTOR" << std::endl;
}

HVAL
Nudp::send(const v8::Arguments& args)
{
    v8::HandleScope scope;

    if (args.Length() < 1) {
        return scope.Close(v8::Undefined());
    }

    v8::Local<v8::Object> buffer_object = args[0]->ToObject();
    char* data = node::Buffer::Data(buffer_object);
    int len = node::Buffer::Length(buffer_object);
    std::cout << "PUSH BUFFER " << len << std::hex;
    for (int i=0; i<len; i++) {
        if (i % 16 == 0) {
            std::cout << std::endl << "&&&";
        }
        std::cout << " " << int(data[i]);
    }
    std::cout << std::dec << std::endl;
    return scope.Close(v8::Undefined());
}
