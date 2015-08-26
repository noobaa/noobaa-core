#include "../util/common.h"

class Nudp : public Nan::ObjectWrap
{
private:
    explicit Nudp();
    ~Nudp();

public:
    static NAN_MODULE_INIT(setup);

private:
    static Nan::Persistent<v8::Function> _ctor;
    static NAN_METHOD(new_instance);
    static NAN_METHOD(send);
};
