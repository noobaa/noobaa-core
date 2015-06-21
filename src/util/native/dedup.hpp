// template hpp

template<DEDUP_TDEF>
Dedup<DEDUP_TARGS>::Dedup()
    : _hasher()
{

}

template<DEDUP_TDEF>
Dedup<DEDUP_TARGS>::~Dedup()
{

}

// statics

template<DEDUP_TDEF>
v8::Persistent<v8::Function>
Dedup<DEDUP_TARGS>::_ctor;

template<DEDUP_TDEF>
void
Dedup<DEDUP_TARGS>::setup(const char* name, HOBJ exports)
{
    auto tpl(NanNew<v8::FunctionTemplate>(Dedup::new_instance));
    tpl->SetClassName(NanNew(name));
    tpl->InstanceTemplate()->SetInternalFieldCount(1);
    NODE_SET_PROTOTYPE_METHOD(tpl, "push", Dedup::push);
    NanAssignPersistent(_ctor, tpl->GetFunction());
    exports->Set(NanNew(name), _ctor);
}

template<DEDUP_TDEF>
NAN_METHOD(Dedup<DEDUP_TARGS>::new_instance)
{
    NanScope();
    if (args.IsConstructCall()) {
        Dedup* obj = new Dedup();
        obj->Wrap(args.This());
        NanReturnValue(args.This());
    } else {
        // Invoked as plain function `Dedup(...)`, turn into construct call.
        const int argc = 1;
        v8::Local<v8::Value> argv[argc] = { args[0] };
        NanReturnValue(_ctor->NewInstance(argc, argv));
    }
}

template<DEDUP_TDEF>
NAN_METHOD(Dedup<DEDUP_TARGS>::push)
{
    NanScope();

    auto self = Unwrap<Dedup<DEDUP_TARGS> >(args.This());
    auto& hasher = self->_hasher;

    if (args.Length() < 1) {
        NanReturnUndefined();
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
        hasher.update(data[i]);
    }

    std::cout
        << std::endl
        << "HASH VALUE: " << hasher.value()
        << std::endl
        << std::dec;

    NanReturnUndefined();
}
