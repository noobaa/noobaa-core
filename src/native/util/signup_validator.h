#ifndef NOOBAA__SIGNUP_VALIDATOR__H
#define NOOBAA__SIGNUP_VALIDATOR__H


#include "common.h"
#include "mutex.h"

namespace noobaa {

class SignupValidator : public Nan::ObjectWrap
{
public:
    static NAN_MODULE_INIT(setup);

private:
    static Nan::Persistent<v8::Function> _ctor;
    static NAN_METHOD(new_instance);
    static NAN_METHOD(validate);

public:

    explicit SignupValidator();
    virtual ~SignupValidator();

private:
};

} // namespace noobaa

#endif // NOOBAA__SIGNUP_VALIDATOR__H
