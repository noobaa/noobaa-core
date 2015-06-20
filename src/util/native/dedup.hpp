// template hpp

// define static members
template<DEDUP_TDEF>
v8::Persistent<v8::Function>
Dedup<DEDUP_TARGS>
::_ctor;

template<DEDUP_TDEF>
void
Dedup<DEDUP_TARGS>
::initialize(const char* name, HOBJ exports)
{
    auto symbol(v8::String::NewSymbol(name));
    auto t(v8::FunctionTemplate::New(Dedup::new_instance));
    t->SetClassName(symbol);
    t->InstanceTemplate()->SetInternalFieldCount(1);
    NODE_SET_PROTOTYPE_METHOD(t, "push", Dedup::_push);
    // save ctor persistent handle to be used by new_instance
    _ctor = v8::Persistent<v8::Function>::New(t->GetFunction());
    exports->Set(symbol, _ctor);
}

template<DEDUP_TDEF>
HVAL
Dedup<DEDUP_TARGS>
::new_instance(const v8::Arguments& args)
{
    v8::HandleScope scope;
    if (args.IsConstructCall()) {
        // Invoked as constructor: `new Dedup(...)`
        // double value = args[0]->IsUndefined() ? 0 : args[0]->NumberValue();
        Dedup* obj = new Dedup();
        obj->Wrap(args.This());
        return args.This();
    } else {
        // Invoked as plain function `Dedup(...)`, turn into construct call.
        const int argc = 1;
        v8::Local<v8::Value> argv[argc] = { args[0] };
        return scope.Close(_ctor->NewInstance(argc, argv));
    }
}

template<DEDUP_TDEF>
Dedup<DEDUP_TARGS>
::Dedup()
    : _hasher()
{

}

template<DEDUP_TDEF>
Dedup<DEDUP_TARGS>
::~Dedup()
{

}

template<DEDUP_TDEF>
HVAL
Dedup<DEDUP_TARGS>
::push(const v8::Arguments& args)
{
    v8::HandleScope scope;

    if (args.Length() < 1) {
        return scope.Close(v8::Undefined());
    }

    auto buffer_object = args[0]->ToObject();
    char* data = node::Buffer::Data(buffer_object);
    int len = node::Buffer::Length(buffer_object);
    std::cout << "DEDUP BUFFER length " << len << std::hex;

    for (int i=0; i<len; i++) {
        if (i % 16 == 0) {
            std::cout << std::endl << "&&&";
        }
        std::cout << " " << int(data[i]);
        _hasher.update(data[i]);
    }

    std::cout
        << std::endl
        << "HASH VALUE: " << _hasher.value()
        << std::endl
        << std::dec;

    return scope.Close(v8::Undefined());
}
