/* Copyright (C) 2016 NooBaa */
#pragma once

#include <list>

#include "../util/nan.h"

#define NUDP_CHECKSUM 0

// utp.h forward declerations
struct utp_iovec;
typedef struct UTPSocket utp_socket;
typedef struct struct_utp_context utp_context;
typedef struct struct_utp_callback_arguments utp_callback_arguments;

namespace noobaa
{

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
    static NAN_METHOD(send_outbound);

private:
    // utp callbacks
    static uint64_t utp_callback_sendto(utp_callback_arguments* a);
    static uint64_t utp_callback_on_read(utp_callback_arguments* a);
    static uint64_t utp_callback_on_state_change(utp_callback_arguments* a);
    static uint64_t utp_callback_on_firewall(utp_callback_arguments* a);
    static uint64_t utp_callback_on_accept(utp_callback_arguments* a);
    static uint64_t utp_callback_on_error(utp_callback_arguments* a);
    static uint64_t utp_callback_log(utp_callback_arguments* a);
    // uv callbacks
    static NAUV_CALLBACK(uv_callback_timer, uv_timer_t* handle);
    static NAUV_CALLBACK(uv_callback_prepare, uv_prepare_t* handle);
    static NAUV_CALLBACK(uv_callback_prepare_close, uv_prepare_t* handle);
    static void uv_callback_send_utp(uv_udp_send_t* req, int status);
    static void uv_callback_send_outbound(uv_udp_send_t* req, int status);
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
    static const int MAX_MSG_LEN = 64 * 1024 * 1024;
    static const int MSG_MAGIC_LEN = 4;
    static const char MSG_HDR_MAGIC[MSG_MAGIC_LEN];

// packing the header so that if it has multiple fields
// then it won't have different padding between different compilers
#pragma pack(push, 1)
    struct MsgHdr {
        char magic[MSG_MAGIC_LEN];
        uint32_t len;
        uint64_t seq;
#if NUDP_CHECKSUM
        uint32_t checksum;
#endif
        MsgHdr()
            : len(0)
            , seq(0)
#if NUDP_CHECKSUM
            , checksum(0)
#endif
        {
            memcpy(magic, MSG_HDR_MAGIC, MSG_MAGIC_LEN);
        }
        void encode();
        void decode();
        bool is_valid();
    };
#pragma pack(pop)

    struct Msg {
        Nan::Persistent<v8::Object> persistent;
        NanCallbackSharedPtr callback;
        std::vector<utp_iovec> iovecs;
        size_t iov_index;
        MsgHdr hdr;

        Msg();
        ~Msg();
    };

    static const int MSG_HDR_SIZE = sizeof(MsgHdr);

private:
    explicit Nudp();
    ~Nudp();
    void _close();
    void _submit_close();
    void _write_data();
    void _read_data(const uint8_t* buf, int len);
    void _bind(const char* address, int port);
    void _setup_socket(utp_socket* socket);
    void _start_receiving();

private:
    utp_context* _utp_ctx;
    utp_socket* _utp_socket;
    uv_timer_t _uv_timer_handle;
    uv_prepare_t _uv_prepare_handle;
    uv_prepare_t _uv_prepare_close_handle;
    uv_udp_t _uv_udp_handle;
    std::list<Msg*> _messages;
    MsgHdr _recv_hdr;
    char* _recv_payload;
    int _recv_hdr_pos;
    int _recv_payload_pos;
    uint64_t _send_msg_seq;
    uint64_t _recv_msg_seq;
    bool _closed;
    bool _receiving;
    int _local_port;
};

} // namespace noobaa
