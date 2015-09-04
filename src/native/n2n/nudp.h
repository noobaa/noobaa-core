#include "../util/common.h"
#include "../third_party/libutp/utp.h"

class Nudp : public Nan::ObjectWrap
{
public:
    static NAN_MODULE_INIT(setup);

private:
    static Nan::Persistent<v8::Function> _ctor;
    static NAN_METHOD(new_instance);
    static NAN_METHOD(send);
    static NAN_METHOD(close);

private:
    static utp_context *_utp_ctx;
    static uint64 callback_sendto(utp_callback_arguments *a);
    static uint64 callback_on_read(utp_callback_arguments *a);
    static uint64 callback_on_state_change(utp_callback_arguments *a);
    static uint64 callback_on_firewall(utp_callback_arguments *a);
    static uint64 callback_on_accept(utp_callback_arguments *a);
    static uint64 callback_on_error(utp_callback_arguments *a);
    static uint64 callback_log(utp_callback_arguments *a);

private:
    explicit Nudp();
    ~Nudp();
    void close();
    void try_write_data();
    void put_read_data(const uint8_t *buf, int len);
    bool _utp_writable;
    utp_socket *_utp_socket;
    uv_udp_t _udp_handle;
    struct Message {
        Nan::Persistent<v8::Object> persistent;
        NanCallbackSharedPtr callback;
        char* data;
        int len;
        int pos;
    };
    std::list<Message*> _write_queue;
};
