#include "nudp.h"

Nan::Persistent<v8::Function> Nudp::_ctor;

NAN_MODULE_INIT(Nudp::setup)
{
    auto name = "Nudp";
    auto tpl = Nan::New<v8::FunctionTemplate>(Nudp::new_instance);
    tpl->SetClassName(NAN_STR(name));
    tpl->InstanceTemplate()->SetInternalFieldCount(1);
    Nan::SetPrototypeMethod(tpl, "send", Nudp::send);
    auto func = Nan::GetFunction(tpl).ToLocalChecked();
    _ctor.Reset(func);
    NAN_SET(target, name, func);
}

NAN_METHOD(Nudp::new_instance)
{
    NAN_MAKE_CTOR_CALL(_ctor);
    Nudp* obj = new Nudp();
    obj->Wrap(info.This());
    info.GetReturnValue().Set(info.This());
}

NAN_METHOD(Nudp::send)
{
    if (info.Length() < 1) {
        NAN_RETURN(Nan::Undefined());
    }

    v8::Local<v8::Object> buffer = Nan::To<v8::Object>(info[0]).ToLocalChecked();
    char* data = node::Buffer::Data(buffer);
    int len = node::Buffer::Length(buffer);
    std::cout << "PUSH BUFFER " << len << std::hex;

    for (int i=0; i<len; i++) {
        if (i % 16 == 0) {
            std::cout << std::endl << "&&&";
        }
        std::cout << " " << int(data[i]);
    }
    std::cout << std::dec << std::endl;

    NAN_RETURN(Nan::Undefined());
}

Nudp::Nudp()
{
    std::cout << "CTOR" << std::endl;
}

Nudp::~Nudp()
{
    std::cout << "DTOR" << std::endl;
}
