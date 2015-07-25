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
Nudp::setup(v8::Handle<v8::Object> exports)
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
    NAN_MAKE_CTOR_CALL(_ctor);
    Nudp* obj = new Nudp();
    obj->Wrap(args.This());
    NanReturnValue(args.This());
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
