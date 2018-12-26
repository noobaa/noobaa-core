/* Copyright (C) 2016 NooBaa */
#include "ntcp.h"

#include "../util/buf.h"
#include "../util/endian.h"

namespace noobaa
{

DBG_INIT(0);

Nan::Persistent<v8::Function> Ntcp::_ctor;

static const int NTCP_SNDBUF_SIZE = 128 * 1024;
static const int NTCP_RCVBUF_SIZE = 128 * 1024;

NAN_MODULE_INIT(Ntcp::setup)
{
    DBG2("Ntcp::setup");
    auto name = "Ntcp";
    auto tpl = Nan::New<v8::FunctionTemplate>(Ntcp::new_instance);
    tpl->SetClassName(NAN_STR(name));
    tpl->InstanceTemplate()->SetInternalFieldCount(1);
    Nan::SetPrototypeMethod(tpl, "close", Ntcp::close);
    Nan::SetPrototypeMethod(tpl, "bind", Ntcp::bind);
    Nan::SetPrototypeMethod(tpl, "listen", Ntcp::listen);
    Nan::SetPrototypeMethod(tpl, "connect", Ntcp::connect);
    Nan::SetPrototypeMethod(tpl, "write", Ntcp::write);
    auto func = Nan::GetFunction(tpl).ToLocalChecked();
    _ctor.Reset(func);
    NAN_SET(target, name, func);
}

NAN_METHOD(Ntcp::new_instance)
{
    NAN_MAKE_CTOR_CALL(_ctor);
    Ntcp* obj = new Ntcp();
    obj->Wrap(info.This());
    info.GetReturnValue().Set(info.This());
}

Ntcp::Ntcp()
    : _recv_payload(NULL)
    , _recv_hdr_pos(0)
    , _recv_payload_pos(0)
    // , _send_msg_seq(1)
    , _recv_msg_seq(1)
    , _closed(false)
    , _reading(false)
    , _local_port(0)
{
    DBG2("Ntcp::Ntcp");
    NAUV_CALL(uv_tcp_init(uv_default_loop(), &_tcp_handle));
    _tcp_handle.data = this;
}

Ntcp::~Ntcp()
{
    DBG2("Ntcp::~Ntcp");
    _close();
}

NAN_METHOD(Ntcp::close)
{
    Ntcp& self = *NAN_UNWRAP_THIS(Ntcp);
    self._close();
    NAN_RETURN(Nan::Undefined());
}

void
Ntcp::_close()
{
    if (_closed) {
        return;
    }
    _closed = true;
    DBG0("Ntcp::close: local_port " << _local_port);
    uv_close(reinterpret_cast<uv_handle_t*>(&_tcp_handle), NULL);
    if (_recv_payload) {
        delete[] _recv_payload;
    }
    Nan::HandleScope scope;
    _reading_persistent.Reset();
    if (*handle()) {
        v8::Local<v8::Value> argv[] = {NAN_STR("close")};
        NAN_CALLBACK(handle(), "emit", 1, argv);
    }
}

NAN_METHOD(Ntcp::bind)
{
    Ntcp& self = *NAN_UNWRAP_THIS(Ntcp);
    int port = NAN_TO_INT(info[0]);
    Nan::Utf8String address(info[1]);
    self._bind(*address, port);
    NAN_RETURN(NAN_INT(self._local_port));
}

void
Ntcp::_bind(const char* address, int port)
{
    DBG1("Ntcp::_bind: " << address << ":" << port);
    if (_closed) {
        DBG5("Ntcp::_bind: closed. ignoring.");
        return; // TODO exception on close?
    }
    if (_local_port) {
        return;
    }
    struct sockaddr_in sin;
    int sin_len = sizeof(sin);
    NAUV_IP4_ADDR(address, port, &sin);
    NAUV_CALL(uv_tcp_bind(&_tcp_handle, NAUV_UDP_ADDR(&sin), 0));
    // once we have a file descriptor we can set the
    int buffer_size = NTCP_SNDBUF_SIZE;
    NAUV_CALL(uv_send_buffer_size(reinterpret_cast<uv_handle_t*>(&_tcp_handle), &buffer_size));
    buffer_size = NTCP_RCVBUF_SIZE;
    NAUV_CALL(uv_recv_buffer_size(reinterpret_cast<uv_handle_t*>(&_tcp_handle), &buffer_size));
    NAUV_CALL(uv_tcp_getsockname(&_tcp_handle, NAUV_UDP_ADDR(&sin), &sin_len));
    _local_port = ntohs(sin.sin_port);
    _start_reading();
}

NAN_METHOD(Ntcp::listen)
{
    Ntcp& self = *NAN_UNWRAP_THIS(Ntcp);
    int port = NAN_TO_INT(info[0]);
    Nan::Utf8String address(info[1]);
    DBG1("Ntcp::listen: " << *address << ":" << port);
    self._bind(*address, port);
    NAUV_CALL(uv_listen(
        reinterpret_cast<uv_stream_t*>(&self._tcp_handle),
        5, // backlog
        &Ntcp::_connection_callback));
    NAN_RETURN(NAN_INT(self._local_port));
}

NAUV_CALLBACK_STATUS(Ntcp::_connection_callback, uv_stream_t* listener)
{
    DBG1("Ntcp::_connection_callback: got connection");
    Nan::HandleScope scope;
    Ntcp& self = *reinterpret_cast<Ntcp*>(listener->data);
    v8::Local<v8::Value> obj(Nan::CallAsConstructor(Nan::New(Ntcp::_ctor), 0, 0).ToLocalChecked());
    Ntcp& conn = *NAN_UNWRAP_OBJ(Ntcp, obj);
    conn._local_port = self._local_port;
    conn._accept(listener);
    v8::Local<v8::Value> argv[] = {NAN_STR("connection"), obj};
    NAN_CALLBACK(self.handle(), "emit", 2, argv);
}

void
Ntcp::_accept(uv_stream_t* listener)
{
    NAUV_CALL(uv_accept(listener, reinterpret_cast<uv_stream_t*>(&_tcp_handle)));
    _start_reading();
}

struct ConnectRequest {
    uv_connect_t req;
    Ntcp* self;
    Nan::Persistent<v8::Object> persistent;
    NanCallbackSharedPtr callback;
};

NAN_METHOD(Ntcp::connect)
{
    Ntcp& self = *NAN_UNWRAP_THIS(Ntcp);
    int port = NAN_TO_INT(info[0]);
    Nan::Utf8String address(info[1]);
    struct sockaddr_in sin;
    NAUV_IP4_ADDR(*address, port, &sin);
    self._bind("0.0.0.0", 0);
    DBG0(
        "Ntcp::connect:"
        << " local_port "
        << self._local_port
        << " to "
        << *address
        << ":"
        << port);
    ConnectRequest* r = new ConnectRequest;
    r->req.data = r;
    r->self = &self;
    r->persistent.Reset(info.This());
    r->callback.reset(new Nan::Callback(info[2].As<v8::Function>()));
    NAUV_CALL(uv_tcp_connect(
        &r->req,
        &self._tcp_handle,
        reinterpret_cast<struct sockaddr*>(&sin),
        &Ntcp::_connect_callback));
    NAN_RETURN(NAN_INT(self._local_port));
}

NAUV_CALLBACK_STATUS(Ntcp::_connect_callback, uv_connect_t* req)
{
    Nan::HandleScope scope;
    ConnectRequest* r = reinterpret_cast<ConnectRequest*>(req->data);
    Ntcp& self = *r->self;
    NanCallbackSharedPtr callback(r->callback);
    r->persistent.Reset();
    delete r;

    if (status < 0) {
        DBG0("Ntcp::_connect_callback: ERROR local_port " << self._local_port);
        v8::Local<v8::Value> argv[] = {NAN_ERR("Ntcp::_connect_callback: ERROR")};
        Nan::Call(*callback, 1, argv);
    } else {
        DBG0("Ntcp::_connect_callback: local_port " << self._local_port);
        self._start_reading();
        v8::Local<v8::Value> args[] = {Nan::Undefined(), NAN_INT(self._local_port)};
        Nan::Call(*callback, 2, args);
    }
}

NAN_METHOD(Ntcp::write)
{
    Ntcp& self = *NAN_UNWRAP_THIS(Ntcp);
    NanCallbackSharedPtr callback(new Nan::Callback(info[1].As<v8::Function>()));
    if (self._closed) {
        DBG5("Ntcp::write: closed. thats an error.");
        v8::Local<v8::Value> argv[] = {NAN_ERR("Ntcp::write: CLOSED")};
        Nan::Call(*callback, 1, argv);
        return;
    }
    // if (!self._local_port) {
    //     DBG5("Ntcp::write: not connected. thats an error.");
    //     v8::Local<v8::Value> argv[] = { NAN_ERR("Ntcp::write: NOT CONNECTED") };
    //     Nan::Call(*callback, 1, argv);
    //     return;
    // }
    uv_write_t* write_req = new uv_write_t;
    Msg* m = new Msg;
    write_req->data = m;
    m->callback = callback;
    v8::Local<v8::Object> buffer_or_buffers = Nan::To<v8::Object>(info[0]).ToLocalChecked();
    m->persistent.Reset(buffer_or_buffers); // keep persistent ref to the buffer
    if (node::Buffer::HasInstance(buffer_or_buffers)) {
        m->iovecs.resize(2);
        m->iovecs[0].base = reinterpret_cast<char*>(&m->hdr);
        m->iovecs[0].len = MSG_HDR_SIZE;
        m->iovecs[1].base = node::Buffer::Data(buffer_or_buffers);
        m->iovecs[1].len = node::Buffer::Length(buffer_or_buffers);
        m->hdr.len = m->iovecs[1].len;
    } else if (buffer_or_buffers->IsArray()) {
        int num_buffers = buffer_or_buffers.As<v8::Array>()->Length();
        m->iovecs.resize(num_buffers + 1);
        m->iovecs[0].base = reinterpret_cast<char*>(&m->hdr);
        m->iovecs[0].len = MSG_HDR_SIZE;
        for (int i = 0; i < num_buffers; ++i) {
            auto buf = NAN_GET_OBJ(buffer_or_buffers, i);
            char* data = node::Buffer::Data(buf);
            int len = node::Buffer::Length(buf);
            m->iovecs[i + 1].base = data;
            m->iovecs[i + 1].len = len;
            m->hdr.len += len;
        }
    } else {
        return Nan::ThrowError("Ntcp::write: expected buffer or array of buffers");
    }
    // m->hdr.seq = self._send_msg_seq++;
    DBG2(
        "Ntcp::write:"
        //  << " seq " << m->hdr.seq
        << " len "
        << m->hdr.len
        << " local_port "
        << self._local_port);
    m->hdr.encode();
    NAUV_CALL(uv_write(
        write_req,
        reinterpret_cast<uv_stream_t*>(&self._tcp_handle),
        m->iovecs.data(),
        m->iovecs.size(),
        &Ntcp::_write_callback));
    NAN_RETURN(Nan::Undefined());
}

NAUV_CALLBACK_STATUS(Ntcp::_write_callback, uv_write_t* req)
{
    Nan::HandleScope scope;
    Msg* m = reinterpret_cast<Msg*>(req->data);
    m->hdr.decode();
    if (status < 0) {
        v8::Local<v8::Value> argv[] = {NAN_ERR("Ntcp::write: ERROR")};
        Nan::Call(*m->callback, 1, argv);
    } else {
        DBG2(
            "Ntcp::_write_callback:"
            // << " seq " << m->hdr.seq
            << " len "
            << m->hdr.len);
        v8::Local<v8::Value> args[] = {Nan::Undefined()};
        Nan::Call(*m->callback, 1, args);
    }
    delete m;
    delete req;
}

void
Ntcp::_start_reading()
{
    if (_closed) {
        DBG5("Ntcp::_start_reading: closed. ignoring.");
        return; // TODO exception on close?
    }
    if (_reading) {
        return;
    }
    _reading = true;
    _reading_persistent.Reset(handle());
    NAUV_CALL(uv_read_start(
        reinterpret_cast<uv_stream_t*>(&_tcp_handle),
        &Ntcp::_callback_alloc_wrap,
        &Ntcp::_callback_read_wrap));
}

void
Ntcp::_callback_alloc(uv_handle_t* handle, size_t suggested_size, uv_buf_t* buf)
{
    Ntcp& self = *reinterpret_cast<Ntcp*>(handle->data);
    self._alloc_for_read(buf, suggested_size);
}

void
Ntcp::_callback_read(uv_stream_t* handle, ssize_t nread, const uv_buf_t* buf)
{
    Ntcp& self = *reinterpret_cast<Ntcp*>(handle->data);
    self._read_data(buf, nread);
}

void
Ntcp::_alloc_for_read(uv_buf_t* buf, size_t suggested_size)
{
    if (!_recv_payload) {
        buf->len = MSG_HDR_SIZE - _recv_hdr_pos;
        buf->base = reinterpret_cast<char*>(&_recv_hdr) + _recv_hdr_pos;
        DBG8(
            "Ntcp::_alloc_for_read: allocate hdr pos " << _recv_hdr_pos << " len " << buf->len
                                                       << " suggested "
                                                       << suggested_size);
    } else {
        buf->len = _recv_hdr.len - _recv_payload_pos;
        buf->base = _recv_payload + _recv_payload_pos;
        DBG8(
            "Ntcp::_alloc_for_read: allocate payload pos " << _recv_payload_pos << " len "
                                                           << buf->len
                                                           << " suggested "
                                                           << suggested_size);
    }
}

void
Ntcp::_read_data(const uv_buf_t* buf, size_t nread)
{
    DBG3("Ntcp::_read_data: nread " << nread);
    if (DBG_VISIBLE(9)) {
        Buf::hexdump(buf->base, nread > 128 ? 128 : nread, "Ntcp::_read_data");
    }
    // if (nread < 0) {
    //     // TODO
    //     PANIC("Ntcp::_read_data failed");
    //     return;
    // }
    if (nread == 0) {
        return; // means EGAIN/EWOULDBLOCK so we can ignore
    }
    if (!_recv_payload) {
        _recv_hdr_pos += nread;
        // process the header when full
        if (_recv_hdr_pos >= MSG_HDR_SIZE) {
            if (DBG_VISIBLE(9)) {
                Buf::hexdump(&_recv_hdr, MSG_HDR_SIZE, "Ntcp::_read_data: (header)");
            }
            _recv_hdr.decode();
            DBG3(
                "Ntcp::_read_data: incoming message"
                //  << " seq " << _recv_hdr.seq
                << " len "
                << _recv_hdr.len
                << " local_port "
                << _local_port);
            if (_recv_hdr.len > MAX_MSG_LEN) {
                // TODO close connection instead of panic
                LOG("Ntcp::_read_data: message too big:"
                    // << " magic " << _recv_hdr.magic
                    // << " seq " << _recv_hdr.seq
                    // << " seq " << _recv_msg_seq
                    << " len "
                    << _recv_hdr.len);
                _recv_hdr.len = 0;
            }
            _recv_payload = new char[_recv_hdr.len];
            _recv_hdr_pos = 0;
            _recv_payload_pos = 0;
        }
    } else {
        _recv_payload_pos += nread;
        // process the payload when full
        if (_recv_payload_pos >= (int)_recv_hdr.len) {
            if (!_recv_hdr.is_valid()
                // || _recv_hdr.seq != _recv_msg_seq
            ) {
                Buf::hexdump(&_recv_hdr, MSG_HDR_SIZE, "Ntcp::_read_data: (header decoded)");
                Buf::hexdump(
                    _recv_payload,
                    _recv_hdr.len > 128 ? 128 : _recv_hdr.len,
                    "Ntcp::_read_data: (payload)");
                // TODO close connection instead of panic
                PANIC(
                    "Ntcp::_read_data: bad message:"
                    //   << " magic " << _recv_hdr.magic
                    //   << " seq " << _recv_hdr.seq
                    //   << " expected " << _recv_msg_seq
                    << " len "
                    << _recv_hdr.len);
            }
            _recv_msg_seq += 1;
            // ownership on memory passed to the node buffer
            Nan::HandleScope scope;
            v8::Local<v8::Object> node_buf =
                Nan::NewBuffer(_recv_payload, _recv_hdr.len).ToLocalChecked();
            _recv_payload = NULL;
            _recv_hdr_pos = 0;
            _recv_payload_pos = 0;
            // emit the message buffer
            DBG3(
                "Ntcp::_read_data: incoming message completed"
                //  << " seq " << _recv_hdr.seq
                << " len "
                << _recv_hdr.len
                << " local_port "
                << _local_port);
            v8::Local<v8::Value> argv[] = {NAN_STR("message"), node_buf};
            NAN_CALLBACK(handle(), "emit", 2, argv);
        }
    }
}

Ntcp::Msg::Msg()
    : iov_index(0) {}

Ntcp::Msg::~Msg()
{
    persistent.Reset();
    callback.reset();
}

void
Ntcp::MsgHdr::encode()
{
    len = htobe32(len);
    // seq = htobe64(seq);
}

void
Ntcp::MsgHdr::decode()
{
    len = be32toh(len);
    // seq = be64toh(seq);
}

const char Ntcp::MSG_HDR_MAGIC[Ntcp::MSG_MAGIC_LEN] = {'N', 't', 'c', 'p'};

bool
Ntcp::MsgHdr::is_valid()
{
    // if (memcmp(magic, MSG_HDR_MAGIC, MSG_MAGIC_LEN)) {
    // return false;
    // }
    return true;
}

} // namespace noobaa
