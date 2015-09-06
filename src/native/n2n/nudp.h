#include "../util/common.h"
#include "../third_party/libutp/utp.h"

class Nudp : public Nan::ObjectWrap
{
public:
    static NAN_MODULE_INIT(setup);

private:
    static Nan::Persistent<v8::Function> _ctor;
    static NAN_METHOD(new_instance);
    static NAN_METHOD(close);
    static NAN_METHOD(bind);
    static NAN_METHOD(connect);
    static NAN_METHOD(send);

private:
    // utp callbacks
    static uint64 utp_callback_sendto(utp_callback_arguments *a);
    static uint64 utp_callback_on_read(utp_callback_arguments *a);
    static uint64 utp_callback_on_state_change(utp_callback_arguments *a);
    static uint64 utp_callback_on_firewall(utp_callback_arguments *a);
    static uint64 utp_callback_on_accept(utp_callback_arguments *a);
    static uint64 utp_callback_on_error(utp_callback_arguments *a);
    static uint64 utp_callback_log(utp_callback_arguments *a);
    // uv callbacks
    static void uv_callback_timer(uv_timer_t* handle, int status);
    static void uv_callback_addrinfo_to_connect(uv_getaddrinfo_t* req, int status, struct addrinfo* res);
    static void uv_callback_addrinfo_to_bind(uv_getaddrinfo_t* req, int status, struct addrinfo* res);
    static void uv_callback_send(uv_udp_send_t* req, int status);
    static uv_buf_t uv_callback_alloc(uv_handle_t* handle, size_t suggested_size);
    static void uv_callback_receive(
        uv_udp_t* handle,
        ssize_t nread,
        uv_buf_t buf,
        struct sockaddr* addr,
        unsigned flags);

private:
    explicit Nudp();
    ~Nudp();
    void close();
    void bind_by_name(std::string host, std::string port);
    void bind_by_addr(struct addrinfo* res);
    void connect_by_name(std::string host, std::string port);
    void connect_by_addr(struct addrinfo* res);
    void try_write_data();
    void put_read_data(const uint8_t *buf, int len);
    void start_receiving();

    utp_context *_utp_ctx;
    utp_socket *_utp_socket;
    uv_timer_t _uv_timer_handle;
    uv_udp_t _uv_udp_handle;
    struct Msg {
        Nan::Persistent<v8::Object> persistent;
        NanCallbackSharedPtr callback;
        char* data;
        int len;
        bool handled_len;
    };
    std::list<Msg*> _messages;
    Msg _incoming_msg;
    bool _receiving;
};
