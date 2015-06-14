#ifndef RABIN_H_
#define RABIN_H_

#include "common.h"

class Rabin : public node::ObjectWrap
{
public:
    // init the module
    static void initialize(HOBJ exports);

private:
    static v8::Persistent<v8::Function> _ctor;

    static HVAL new_instance(const v8::Arguments& args);

    // convinient function to get current this object from context
    static Rabin& self(const v8::Arguments& args) {
        return *ObjectWrap::Unwrap<Rabin>(args.This());
    }

    explicit Rabin();
    ~Rabin();

    // push a buffer
    HVAL push(const v8::Arguments& args);
    static HVAL _push(const v8::Arguments& args) {
        return self(args).push(args);
    }
};

#endif // RABIN_H_
