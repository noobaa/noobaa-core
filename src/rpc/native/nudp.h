#include "../../util/native/common.h"

class Nudp : public node::ObjectWrap
{
private:
    explicit Nudp();
    ~Nudp();

public:
    static void setup(HOBJ exports);

private:
    static v8::Persistent<v8::Function> _ctor;
    static NAN_METHOD(new_instance);
    static NAN_METHOD(send);
};
