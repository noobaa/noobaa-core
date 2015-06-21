#include "nudp.h"

Nudp::Nudp()
{
    std::cout << "CTOR" << std::endl;
}

Nudp::~Nudp()
{
    std::cout << "DTOR" << std::endl;
}

v8::Persistent<v8::Function> Nudp::_ctor;

void
Nudp::setup(HOBJ exports)
{
    auto tpl(NanNew<v8::FunctionTemplate>(Nudp::new_instance));
    tpl->SetClassName(NanNew("Nudp"));
    tpl->InstanceTemplate()->SetInternalFieldCount(1);
    NODE_SET_PROTOTYPE_METHOD(tpl, "send", Nudp::send);
    NanAssignPersistent(_ctor, tpl->GetFunction());
    exports->Set(NanNew("Nudp"), _ctor);
}

NAN_METHOD(Nudp::new_instance)
{
    NanScope();
    if (args.IsConstructCall()) {
        Nudp* obj = new Nudp();
        obj->Wrap(args.This());
        NanReturnValue(args.This());
    } else {
        // Invoked as plain function `Nudp(...)`, turn into construct call.
        const int argc = 1;
        v8::Local<v8::Value> argv[argc] = { args[0] };
        NanReturnValue(_ctor->NewInstance(argc, argv));
    }
}

NAN_METHOD(Nudp::send)
{
    NanScope();

    if (args.Length() < 1) {
        NanReturnUndefined();
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

    NanReturnUndefined();
}
