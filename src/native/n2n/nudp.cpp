#include "nudp.h"

Nan::Persistent<v8::Function> Nudp::_ctor;
utp_context *Nudp::_utp_ctx;
uv_prepare_t Nudp::_uv_prepare_handle;

static
std::string
addrinfo2str(const struct addrinfo* ai)
{
    const struct sockaddr_in *in = reinterpret_cast<const struct sockaddr_in *>(ai->ai_addr);
    return std::string(inet_ntoa(in->sin_addr)) + ":" + std::to_string(ntohs(in->sin_port));
}

static
std::string
sockaddr2str(const struct sockaddr* sa)
{
    const struct sockaddr_in *in = reinterpret_cast<const struct sockaddr_in *>(sa);
    return std::string(inet_ntoa(in->sin_addr)) + ":" + std::to_string(ntohs(in->sin_port));
}

NAN_MODULE_INIT(Nudp::setup)
{
    auto name = "Nudp";
    auto tpl = Nan::New<v8::FunctionTemplate>(Nudp::new_instance);
    tpl->SetClassName(NAN_STR(name));
    tpl->InstanceTemplate()->SetInternalFieldCount(1);
    Nan::SetPrototypeMethod(tpl, "close", Nudp::close);
    Nan::SetPrototypeMethod(tpl, "bind", Nudp::bind);
    Nan::SetPrototypeMethod(tpl, "connect", Nudp::connect);
    Nan::SetPrototypeMethod(tpl, "send", Nudp::send);
    auto func = Nan::GetFunction(tpl).ToLocalChecked();
    _ctor.Reset(func);
    NAN_SET(target, name, func);

    _utp_ctx = utp_init(2); // version=2
    utp_set_callback(_utp_ctx, UTP_SENDTO,           &Nudp::utp_callback_sendto);
    utp_set_callback(_utp_ctx, UTP_ON_READ,          &Nudp::utp_callback_on_read);
    utp_set_callback(_utp_ctx, UTP_ON_STATE_CHANGE,  &Nudp::utp_callback_on_state_change);
    utp_set_callback(_utp_ctx, UTP_ON_FIREWALL,      &Nudp::utp_callback_on_firewall);
    utp_set_callback(_utp_ctx, UTP_ON_ACCEPT,        &Nudp::utp_callback_on_accept);
    utp_set_callback(_utp_ctx, UTP_ON_ERROR,         &Nudp::utp_callback_on_error);
    utp_set_callback(_utp_ctx, UTP_LOG,              &Nudp::utp_callback_log);

    if (uv_prepare_init(uv_default_loop(), &Nudp::_uv_prepare_handle)) {
        PANIC("Nudp::setup: uv_prepare_init failed");
    }
    if (uv_prepare_start(&Nudp::_uv_prepare_handle, &Nudp::uv_callback_prepare)) {
        PANIC("Nudp::setup: uv_prepare_start failed");
    }
}

NAN_METHOD(Nudp::new_instance)
{
    NAN_MAKE_CTOR_CALL(_ctor);
    Nudp* obj = new Nudp();
    obj->Wrap(info.This());
    info.GetReturnValue().Set(info.This());
}

NAN_METHOD(Nudp::close)
{
    Nudp& self = *NAN_UNWRAP_THIS(Nudp);
    self.close();
    NAN_RETURN(Nan::Undefined());
}

NAN_METHOD(Nudp::bind)
{
    Nudp& self = *NAN_UNWRAP_THIS(Nudp);
    std::string host = *Nan::Utf8String(info[0]);
    std::string port = *Nan::Utf8String(info[1]);
    self.bind_by_name(host, port);
    NAN_RETURN(Nan::Undefined());
}

NAN_METHOD(Nudp::connect)
{
    Nudp& self = *NAN_UNWRAP_THIS(Nudp);
    std::string host = *Nan::Utf8String(info[0]);
    std::string port = *Nan::Utf8String(info[1]);
    // int port = info[1]->Int32Value();
    self.connect_by_name(host, port);
    NAN_RETURN(Nan::Undefined());
}

NAN_METHOD(Nudp::send)
{
    Nudp& self = *NAN_UNWRAP_THIS(Nudp);
    if (info.Length() < 1) {
        NAN_RETURN(Nan::Undefined());
    }
    v8::Local<v8::Object> buffer = Nan::To<v8::Object>(info[0]).ToLocalChecked();
    Msg* m = new Msg;
    m->persistent.Reset(buffer); // keep persistent ref to the buffer
    m->callback.reset(new Nan::Callback(info[1].As<v8::Function>()));
    m->data = node::Buffer::Data(buffer);
    m->len = node::Buffer::Length(buffer);
    m->handled_len = false;
    self._messages.push_back(m);
    self.try_write_data();
    NAN_RETURN(Nan::Undefined());
}

// check for utp events in the uv loop
void
Nudp::uv_callback_prepare(uv_prepare_t* h)
{
    LOG("Nudp::uv_callback_prepare");
    utp_issue_deferred_acks(Nudp::_utp_ctx);
    utp_check_timeouts(Nudp::_utp_ctx);
}

void
Nudp::uv_callback_addrinfo_to_bind(uv_getaddrinfo_t* req, int status, struct addrinfo* res)
{
    if (status == 0) {
        Nudp& self = *static_cast<Nudp*>(req->data);
        self.bind_by_addr(res);
    } else {
        LOG("Nudp::uv_callback_addrinfo_to_bind: getaddrinfo failed " << status);
    }
    uv_freeaddrinfo(res);
}

void
Nudp::uv_callback_addrinfo_to_connect(uv_getaddrinfo_t* req, int status, struct addrinfo* res)
{
    if (status == 0) {
        Nudp& self = *static_cast<Nudp*>(req->data);
        self.connect_by_addr(res);
    } else {
        LOG("Nudp::uv_callback_addrinfo_to_connect: getaddrinfo failed " << status);
    }
    uv_freeaddrinfo(res);
}

void
Nudp::uv_callback_send(uv_udp_send_t* req, int status)
{
    LOG("Nudp::uv_callback_send: status " << status);
    delete req;
}

void
Nudp::uv_callback_alloc(uv_handle_t* handle, size_t suggested_size, uv_buf_t* buf)
{
    LOG("Nudp::uv_callback_alloc: suggested_size " << suggested_size);
    buf->base = reinterpret_cast<char*>(uv_malloc_func(suggested_size));
    buf->len = suggested_size;
}

void
Nudp::uv_callback_receive(
    uv_udp_t* handle,
    ssize_t nread,
    const uv_buf_t* buf,
    const struct sockaddr* addr,
    unsigned flags)
{
    if (flags & UV_UDP_PARTIAL) {
        LOG("Nudp::uv_callback_receive: truncated packet ... TODO ...");
    }
    LOG("Nudp::uv_callback_receive: packet from " << sockaddr2str(addr));
    const byte* data = reinterpret_cast<const byte*>(buf->base);
    if (!utp_process_udp(_utp_ctx, data, buf->len, addr, sizeof(struct sockaddr))) {
        LOG("UDP packet not handled by UTP. Ignoring.");
    }
}

uint64_t
Nudp::utp_callback_sendto(utp_callback_arguments *a)
{
    LOG("Nudp::utp_callback_sendto: buffer length " << a->len);
    if (!a->socket) {
        LOG("Nudp::utp_callback_sendto: TODO send RESET through global udp socket");
        return 0;
    }
    Nudp& self = *static_cast<Nudp*>(utp_get_userdata(a->socket));
    uv_buf_t buf = uv_buf_init(reinterpret_cast<char*>(const_cast<uint8_t*>(a->buf)), a->len);
    uv_udp_send_t* req = new uv_udp_send_t;
    // TODO should we copy the buffer for the uv async call?
    if (uv_udp_send(req, &self._uv_udp_handle, &buf, 1, a->address, Nudp::uv_callback_send)) {
        PANIC("Nudp::utp_callback_sendto: uv_udp_send failed");
    }
    return 0;
}

uint64_t
Nudp::utp_callback_on_read(utp_callback_arguments *a)
{
    LOG("Nudp::utp_callback_on_read: buffer length " << a->len);
    Nudp& self = *static_cast<Nudp*>(utp_get_userdata(a->socket));
    self.put_read_data(a->buf, a->len);
    utp_read_drained(a->socket);
    return 0;
}

uint64_t
Nudp::utp_callback_on_state_change(utp_callback_arguments *a)
{
    LOG("Nudp::utp_callback_on_state_change: state " <<
        utp_state_names[a->state] << " (" << a->state << ")");
    Nudp& self = *static_cast<Nudp*>(utp_get_userdata(a->socket));
    utp_socket_stats *stats;

    switch (a->state) {
    case UTP_STATE_CONNECT:
    case UTP_STATE_WRITABLE:
        self.try_write_data();
        break;

    case UTP_STATE_EOF:
        LOG("Nudp::utp_callback_on_state_change: EOF");
        self.close();
        break;

    case UTP_STATE_DESTROYING:
        LOG("Nudp::utp_callback_on_state_change: destroying");
        stats = utp_get_stats(a->socket);
        if (stats) {
            LOG("Nudp::utp_callback_on_state_change: stats:");
            LOG("    Bytes sent:          " << stats->nbytes_xmit);
            LOG("    Bytes received:      " << stats->nbytes_recv);
            LOG("    Packets received:    " << stats->nrecv);
            LOG("    Packets sent:        " << stats->nxmit);
            LOG("    Duplicate receives:  " << stats->nduprecv);
            LOG("    Retransmits:         " << stats->rexmit);
            LOG("    Fast Retransmits:    " << stats->fastrexmit);
            LOG("    Best guess at MTU:   " << stats->mtu_guess);
        } else {
            LOG("Nudp::utp_callback_on_state_change: stats not available");
        }
        break;
    }

    return 0;
}

uint64_t
Nudp::utp_callback_on_firewall(utp_callback_arguments *a)
{
    LOG("Nudp::utp_callback_on_firewall");
    return 0;
}

uint64_t
Nudp::utp_callback_on_accept(utp_callback_arguments *a)
{
    LOG("Nudp::utp_callback_on_accept");
    return 0;
}

uint64_t
Nudp::utp_callback_on_error(utp_callback_arguments *a)
{
    LOG("Nudp::utp_callback_on_error " << utp_error_code_names[a->error_code]);
    Nudp& self = *static_cast<Nudp*>(utp_get_userdata(a->socket));
    self.close();
    return 0;
}

uint64_t
Nudp::utp_callback_log(utp_callback_arguments *a)
{
    LOG("Nudp::utp_callback_log " << a->buf);
    return 0;
}


Nudp::Nudp()
{
    LOG("Nudp::Nudp");
    _incoming_msg.data = 0;
    _incoming_msg.len = 0;
    _incoming_msg.handled_len = false;
    _utp_socket = utp_create_socket(Nudp::_utp_ctx);
    utp_set_userdata(_utp_socket, this);
    if (uv_udp_init(uv_default_loop(), &_uv_udp_handle)) {
        PANIC("Nudp::Nudp: uv_udp_init failed");
    }
    if (uv_udp_recv_start(&_uv_udp_handle, &Nudp::uv_callback_alloc, &Nudp::uv_callback_receive)) {
        PANIC("Nudp::Nudp: uv_udp_recv_start failed");
    }
}

Nudp::~Nudp()
{
    LOG("Nudp::~Nudp");
    close();
}

void
Nudp::close()
{
    LOG("Nudp::close");
    uv_close(reinterpret_cast<uv_handle_t*>(&_uv_udp_handle), NULL);
    if (_utp_socket) {
        utp_close(_utp_socket);
        _utp_socket = NULL;
    }
}

void
Nudp::bind_by_name(std::string host, std::string port)
{
    LOG("Nudp::bind_by_name: bind to " << host << ":" + port);
    uv_getaddrinfo_t* req = new uv_getaddrinfo_t;
    req->data = this;
    struct addrinfo hints;
    memset(&hints, 0, sizeof(hints));
	hints.ai_family = AF_INET;
	hints.ai_socktype = SOCK_DGRAM;
	hints.ai_protocol = IPPROTO_UDP;
    uv_getaddrinfo(uv_default_loop(), req, &Nudp::uv_callback_addrinfo_to_bind, host.c_str(), port.c_str(), &hints);
}

void
Nudp::bind_by_addr(struct addrinfo* res)
{
    LOG("Nudp::bind_by_addr: bind to " << addrinfo2str(res));
    if (int rc = uv_udp_bind(&_uv_udp_handle, res->ai_addr, 0)) {
        PANIC("Nudp::bind_by_addr: uv_udp_bind failed - " << uv_strerror(rc));
    }
}

void
Nudp::connect_by_name(std::string host, std::string port)
{
    LOG("Nudp::connect_by_name: connecting to " << host << ":" + port);
    uv_getaddrinfo_t* req = new uv_getaddrinfo_t;
    req->data = this;
    struct addrinfo hints;
    memset(&hints, 0, sizeof(hints));
	hints.ai_family = AF_INET;
	hints.ai_socktype = SOCK_DGRAM;
	hints.ai_protocol = IPPROTO_UDP;
    uv_getaddrinfo(uv_default_loop(), req, &Nudp::uv_callback_addrinfo_to_connect, host.c_str(), port.c_str(), &hints);
}

void
Nudp::connect_by_addr(struct addrinfo* res)
{
    LOG("Nudp::connect_by_addr: connecting to " << addrinfo2str(res));
    utp_connect(_utp_socket, res->ai_addr, res->ai_addrlen);
}

void
Nudp::try_write_data()
{
    LOG("Nudp::try_write_data");
    while (!_messages.empty()) {
        Msg* m = _messages.front();
        if (!m->handled_len) {
            uint32_t msg_len = htonl(m->len);
            size_t sent = utp_write(_utp_socket, &msg_len, sizeof(uint32));
            LOG("Nudp::try_write_data: write message len " << m->len << " sent " << sent);
            if (sent == 4) {
                m->handled_len = true;
            } else if (sent == 0) {
                break;
            } else {
                PANIC("SHORT UTP WRITE OF MSG LEN");
            }
        }
        while (m->len > 0) {
            size_t sent = utp_write(_utp_socket, m->data, m->len);
            LOG("Nudp::try_write_data: write message data " << m->len << " sent " << sent);
            if (sent <= 0) {
                break;
            }
            m->data += sent;
            m->len -= sent;
        }
        if (m->len <= 0) {
            LOG("Nudp::try_write_data: write message done");
            _messages.pop_front();
            v8::Local<v8::Value> argv[] = { Nan::Undefined() };
            m->persistent.Reset();
            m->callback->Call(1, argv);
            m->callback.reset();
            delete m;
        }
    }
}

void
Nudp::put_read_data(const uint8_t *buf, int len)
{
    LOG("Nudp::put_read_data");
    Nan::HandleScope scope;
    while (len > 0) {
        if (_incoming_msg.handled_len) {
            if (len < 4) {
                PANIC("SHORT UTP READ OF MSG LEN");
            }
            uint32_t msg_len = ntohl(reinterpret_cast<const uint32_t*>(buf)[0]);
            auto node_buf = Nan::NewBuffer(msg_len).ToLocalChecked();
            _incoming_msg.len = msg_len;
            _incoming_msg.data = node::Buffer::Data(node_buf);
            _incoming_msg.persistent.Reset(node_buf);
            buf += 4;
            len -= 4;
        }
        int copy_len = len < _incoming_msg.len ? len : _incoming_msg.len;
        memcpy(_incoming_msg.data, buf, copy_len);
        buf += copy_len;
        len -= copy_len;
        _incoming_msg.data += copy_len;
        _incoming_msg.len -= copy_len;
        if (_incoming_msg.len <= 0) {
            auto node_buf = Nan::New(_incoming_msg.persistent);
            _incoming_msg.persistent.Reset();
            _incoming_msg.data = 0;
            v8::Handle<v8::Value> argv[2] = { NAN_STR("message"), node_buf };
            Nan::MakeCallback(handle(), "emit", 2, argv);
        }
    }
}
