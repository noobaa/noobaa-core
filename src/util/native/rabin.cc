#include "rabin.h"

v8::Persistent<v8::Function> Rabin::_ctor;

void
Rabin::initialize(HOBJ exports)
{
    v8::Local<v8::FunctionTemplate> t(v8::FunctionTemplate::New(Rabin::new_instance));
    t->SetClassName(v8::String::NewSymbol("Rabin"));
    t->InstanceTemplate()->SetInternalFieldCount(1);
    NODE_SET_PROTOTYPE_METHOD(t, "push", Rabin::_push);

    // save ctor persistent handle to be used by new_instance
    _ctor = v8::Persistent<v8::Function>::New(t->GetFunction());
    exports->Set(v8::String::NewSymbol("Rabin"), _ctor);
}

HVAL
Rabin::new_instance(const v8::Arguments& args)
{
    v8::HandleScope scope;
    if (args.IsConstructCall()) {
        // Invoked as constructor: `new Rabin(...)`
        // double value = args[0]->IsUndefined() ? 0 : args[0]->NumberValue();
        Rabin* obj = new Rabin();
        obj->Wrap(args.This());
        return args.This();
    } else {
        // Invoked as plain function `Rabin(...)`, turn into construct call.
        const int argc = 1;
        v8::Local<v8::Value> argv[argc] = { args[0] };
        return scope.Close(_ctor->NewInstance(argc, argv));
    }
}

Rabin::Rabin()
{
    std::cout << "CTOR" << std::endl;
}

Rabin::~Rabin()
{
    std::cout << "DTOR" << std::endl;
}

HVAL
Rabin::push(const v8::Arguments& args)
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
