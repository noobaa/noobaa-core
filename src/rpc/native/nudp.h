#include <v8.h>
#include <uv.h>
#include <node.h>
#include <node_buffer.h>
#include <iostream>

typedef v8::Handle<v8::Object> HOBJ;
typedef v8::Handle<v8::Value> HVAL;

class Nudp : public node::ObjectWrap
{
public:
    // init the module
    static void initialize(HOBJ exports);

private:
    static v8::Persistent<v8::Function> _ctor;

    static HVAL new_instance(const v8::Arguments& args);

    // convinient function to get current this object from context
    static Nudp& self(const v8::Arguments& args) {
        return *ObjectWrap::Unwrap<Nudp>(args.This());
    }

    explicit Nudp();
    ~Nudp();

    // send a message
    HVAL send(const v8::Arguments& args);
    static HVAL _send(const v8::Arguments& args) {
        return self(args).send(args);
    }
};
