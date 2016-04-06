#ifndef NOOBAA__SYSLOG__H
#define NOOBAA__SYSLOG__H

#ifndef WIN32

#include "common.h"
#include "mutex.h"

namespace noobaa {

class Syslog : public Nan::ObjectWrap
{
public:
    static NAN_MODULE_INIT(setup);

private:
    static Nan::Persistent<v8::Function> _ctor;
    static NAN_METHOD(new_instance);
    static NAN_METHOD(log);
    static NAN_METHOD(openlog);

public:

    explicit Syslog();
    virtual ~Syslog();

private:
};

} // namespace noobaa

#endif //WIN32
#endif // NOOBAA__SYSLOG__H
