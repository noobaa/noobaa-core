#ifndef NOOBAA__NUDP__H
#define NOOBAA__NUDP__H

#include "../util/common.h"
#include "../util/uvh.h"

// utp.h forward declerations
typedef struct UTPSocket utp_socket;
typedef struct struct_utp_context utp_context;
typedef struct struct_utp_callback_arguments utp_callback_arguments;

namespace noobaa {

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
    static NAN_METHOD(stats);
    static NAN_METHOD(send_stun);

private:
    // utp callbacks
    static uint64_t utp_callback_sendto(utp_callback_arguments *a);
    static uint64_t utp_callback_on_read(utp_callback_arguments *a);
    static uint64_t utp_callback_on_state_change(utp_callback_arguments *a);
    static uint64_t utp_callback_on_firewall(utp_callback_arguments *a);
    static uint64_t utp_callback_on_accept(utp_callback_arguments *a);
    static uint64_t utp_callback_on_error(utp_callback_arguments *a);
    static uint64_t utp_callback_log(utp_callback_arguments *a);
    // uv callbacks
    static NAUV_CALLBACK(uv_callback_timer, uv_timer_t* handle);
    static NAUV_CALLBACK(uv_callback_prepare, uv_prepare_t* handle);
    static void uv_callback_send_utp(uv_udp_send_t* req, int status);
    static void uv_callback_send_stun(uv_udp_send_t* req, int status);
    static void uv_callback_alloc(uv_handle_t* handle, size_t suggested_size, uv_buf_t* buf);
    static void uv_callback_receive(
        uv_udp_t* handle,
        ssize_t nread,
        const uv_buf_t* buf,
        const struct sockaddr* addr,
        unsigned flags);
    static NAUV_ALLOC_CB_WRAP(uv_callback_alloc_wrap, uv_callback_alloc);
    static NAUV_UDP_RECEIVE_CB_WRAP(uv_callback_receive_wrap, uv_callback_receive);

private:
    explicit Nudp();
    ~Nudp();
    void close();
    void on_write_data();
    void on_read_data(const uint8_t *buf, int len);
    void setup_socket(utp_socket* socket);
    void start_receiving();

    utp_context* _utp_ctx;
    utp_socket* _utp_socket;
    uv_timer_t _uv_timer_handle;
    uv_prepare_t _uv_prepare_handle;
    uv_udp_t _uv_udp_handle;
    struct Msg {
        Nan::Persistent<v8::Object> persistent;
        NanCallbackSharedPtr callback;
        char* data;
        int len;
        int pos;
        static const int HDR_LEN = sizeof(uint32_t);
        char hdr_buf[HDR_LEN];
        int hdr_pos;
    };
    std::list<Msg*> _messages;
    Msg _incoming_msg;
    bool _receiving;
};

} // namespace noobaa

#endif // NOOBAA__NUDP__H
