#ifndef WIN32


#include "syslog.h"
#include <syslog.h>

namespace noobaa {

Nan::Persistent<v8::Function> Syslog::_ctor;

NAN_MODULE_INIT(Syslog::setup)
{
    auto name = "Syslog";
    auto tpl = Nan::New<v8::FunctionTemplate>(Syslog::new_instance);
    tpl->SetClassName(NAN_STR(name));
    tpl->InstanceTemplate()->SetInternalFieldCount(1);
    Nan::SetPrototypeMethod(tpl, "log", Syslog::log);
    Nan::SetPrototypeMethod(tpl, "openlog", Syslog::openlog);
    auto func = Nan::GetFunction(tpl).ToLocalChecked();
    _ctor.Reset(func);
    NAN_SET(target, name, func);
}

NAN_METHOD(Syslog::new_instance)
{
    NAN_MAKE_CTOR_CALL(_ctor);
    Syslog* obj = new Syslog();
    obj->Wrap(info.This());
    info.GetReturnValue().Set(info.This());
}

Syslog::Syslog()
{
    LOG("Syslog created" );
}

Syslog::~Syslog()
{
}

NAN_METHOD(Syslog::log) {
    int priority = info[0]->Int32Value();
    Nan::Utf8String msg(info[1]);
    syslog(priority|LOG_LOCAL0, "%s", *msg);
}

static char ident[1024];

NAN_METHOD(Syslog::openlog) {

    // openlog requires ident be statically allocated. Write doesn't guarantee
    // NULL-termination, so preserve last byte as NULL.
    info[0]->ToString()->WriteUtf8(ident, sizeof(ident)-1);
    // int option = info[1]->Int32Value();
    // int facility = info[2]->Int32Value();

    ::openlog(ident, LOG_PID, LOG_LOCAL0);

    return;
}

} // namespace noobaa


#endif //WIN32
