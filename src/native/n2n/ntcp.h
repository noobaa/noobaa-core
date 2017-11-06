/* Copyright (C) 2016 NooBaa */
#pragma once

#include "../util/nan.h"

namespace noobaa
{

class Ntcp : public Nan::ObjectWrap
{
public:
    static NAN_MODULE_INIT(setup);

private:
    static Nan::Persistent<v8::Function> _ctor;
    static NAN_METHOD(new_instance);
    static NAN_METHOD(close);
    static NAN_METHOD(bind);
    static NAN_METHOD(listen);
    static NAN_METHOD(connect);
    static NAN_METHOD(write);

private:
    // uv callbacks
    static NAUV_CALLBACK_STATUS(_connection_callback, uv_stream_t* handle);
    static NAUV_CALLBACK_STATUS(_connect_callback, uv_connect_t* handle);
    static NAUV_CALLBACK_STATUS(_write_callback, uv_write_t* handle);
    static NAUV_ALLOC_CB_WRAP(_callback_alloc_wrap, _callback_alloc);
    static NAUV_READ_CB_WRAP(_callback_read_wrap, _callback_read);
    static void _callback_alloc(uv_handle_t* handle, size_t suggested_size, uv_buf_t* buf);
    static void _callback_read(uv_stream_t* handle, ssize_t nread, const uv_buf_t* buf);

private:
    static const int MAX_MSG_LEN = 64 * 1024 * 1024;
    static const int MSG_MAGIC_LEN = 4;
    static const char MSG_HDR_MAGIC[MSG_MAGIC_LEN];

// packing the header so that if it has multiple fields
// then it won't have different padding between different compilers
#pragma pack(push, 1)
    struct MsgHdr {
        // char magic[MSG_MAGIC_LEN];
        uint32_t len;
        // uint64_t seq;
        MsgHdr()
            : len(0)
        // , seq(0)
        {
            // memcpy(magic, MSG_HDR_MAGIC, MSG_MAGIC_LEN);
        }
        void encode();
        void decode();
        bool is_valid();
    };
#pragma pack(pop)

    struct Msg {
        Nan::Persistent<v8::Object> persistent;
        NanCallbackSharedPtr callback;
        std::vector<uv_buf_t> iovecs;
        size_t iov_index;
        MsgHdr hdr;

        Msg();
        ~Msg();
    };

    static const int MSG_HDR_SIZE = sizeof(MsgHdr);

private:
    explicit Ntcp();
    ~Ntcp();
    void _close();
    void _bind(const char* address, int port);
    void _accept(uv_stream_t* listener);
    void _start_reading();
    void _alloc_for_read(uv_buf_t* buf, size_t suggested_size);
    void _read_data(const uv_buf_t* buf, size_t nread);

private:
    uv_tcp_t _tcp_handle;
    MsgHdr _recv_hdr;
    char* _recv_payload;
    int _recv_hdr_pos;
    int _recv_payload_pos;
    // uint64_t _send_msg_seq;
    uint64_t _recv_msg_seq;
    bool _closed;
    bool _reading;
    Nan::Persistent<v8::Object> _reading_persistent;
    int _local_port;
};

} // namespace noobaa
