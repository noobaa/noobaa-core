#include <node.h>
#include <v8.h>

using namespace v8;

Handle<Value> nudp_sendv(const Arguments& args) {

    // int fd = (wrap == NULL) ? -1 : wrap->handle_.io_watcher.fd;

    HandleScope scope;
    return scope.Close(String::New("world"));
}

void nudp_init(Handle<Object> exports) {
    exports->Set(
        String::NewSymbol("sendv"),
        FunctionTemplate::New(nudp_sendv)->GetFunction());
}

NODE_MODULE(rpc_nudp_native, nudp_init)
