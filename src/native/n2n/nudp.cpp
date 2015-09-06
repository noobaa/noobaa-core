#include "nudp.h"

Nan::Persistent<v8::Function> Nudp::_ctor;

static std::string addrinfo2str(const struct addrinfo* ai);
static std::string sockaddr2str(const struct sockaddr* sa);
static void hexdump(const void *p, size_t len);

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
}

NAN_METHOD(Nudp::new_instance)
{
    NAN_MAKE_CTOR_CALL(_ctor);
    Nudp* obj = new Nudp();
    obj->Wrap(info.This());
    info.GetReturnValue().Set(info.This());
}

Nudp::Nudp()
    : _utp_socket(NULL)
    , _receiving(false)
{
    _incoming_msg.data = 0;
    _incoming_msg.len = 0;
    _incoming_msg.handled_len = false;

    _utp_ctx = utp_init(2); // version=2
    utp_set_callback(_utp_ctx, UTP_SENDTO,           &Nudp::utp_callback_sendto);
    utp_set_callback(_utp_ctx, UTP_ON_READ,          &Nudp::utp_callback_on_read);
    utp_set_callback(_utp_ctx, UTP_ON_STATE_CHANGE,  &Nudp::utp_callback_on_state_change);
    utp_set_callback(_utp_ctx, UTP_ON_FIREWALL,      &Nudp::utp_callback_on_firewall);
    utp_set_callback(_utp_ctx, UTP_ON_ACCEPT,        &Nudp::utp_callback_on_accept);
    utp_set_callback(_utp_ctx, UTP_ON_ERROR,         &Nudp::utp_callback_on_error);
    utp_set_callback(_utp_ctx, UTP_LOG,              &Nudp::utp_callback_log);
    utp_context_set_option(_utp_ctx, UTP_LOG_NORMAL, 1);
    utp_context_set_option(_utp_ctx, UTP_LOG_MTU,    1);
    utp_context_set_option(_utp_ctx, UTP_LOG_DEBUG,  1);
    utp_context_set_userdata(_utp_ctx, this);

    if (uv_udp_init(uv_default_loop(), &_uv_udp_handle)) {
        PANIC("Nudp::Nudp: uv_udp_init failed - "
            << uv_strerror(uv_last_error(uv_default_loop())));
    }
    if (uv_timer_init(uv_default_loop(), &_uv_timer_handle)) {
        PANIC("Nudp::setup: uv_timer_init failed - "
            << uv_strerror(uv_last_error(uv_default_loop())));
    }
    if (uv_timer_start(&_uv_timer_handle, &Nudp::uv_callback_timer, 0, 100)) {
        PANIC("Nudp::setup: uv_timer_start failed - "
            << uv_strerror(uv_last_error(uv_default_loop())));
    }
    _uv_udp_handle.data = this;
    _uv_timer_handle.data = this;
}

Nudp::~Nudp()
{
    LOG("Nudp::~Nudp");
    close();
}

NAN_METHOD(Nudp::close)
{
    Nudp& self = *NAN_UNWRAP_THIS(Nudp);
    self.close();
    NAN_RETURN(Nan::Undefined());
}

void
Nudp::close()
{
    LOG("Nudp::close");
    uv_close(reinterpret_cast<uv_handle_t*>(&_uv_udp_handle), NULL);
    uv_close(reinterpret_cast<uv_handle_t*>(&_uv_timer_handle), NULL);
    if (_utp_socket) {
        utp_close(_utp_socket);
        _utp_socket = NULL;
    }
}

NAN_METHOD(Nudp::bind)
{
    Nudp& self = *NAN_UNWRAP_THIS(Nudp);
    std::string host = *Nan::Utf8String(info[0]);
    std::string port = *Nan::Utf8String(info[1]);
    self.bind_by_name(host, port);
    NAN_RETURN(Nan::Undefined());
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
    if (uv_getaddrinfo(uv_default_loop(), req, &Nudp::uv_callback_addrinfo_to_bind,
        host.c_str(), port.c_str(), &hints)) {
        PANIC("Nudp::bind_by_name: uv_getaddrinfo failed - "
            << uv_strerror(uv_last_error(uv_default_loop())));
    }
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
    delete req;
}

void
Nudp::bind_by_addr(struct addrinfo* res)
{
    LOG("Nudp::bind_by_addr: bind to " << addrinfo2str(res));
    const struct sockaddr_in* sin = reinterpret_cast<const struct sockaddr_in*>(res->ai_addr);
    if (uv_udp_bind(&_uv_udp_handle, *sin, 0)) {
        PANIC("Nudp::bind_by_addr: uv_udp_bind failed - "
            << uv_strerror(uv_last_error(uv_default_loop())));
    }
    start_receiving();
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
    if (uv_getaddrinfo(uv_default_loop(), req, &Nudp::uv_callback_addrinfo_to_connect,
        host.c_str(), port.c_str(), &hints)) {
        PANIC("Nudp::connect_by_name: uv_getaddrinfo failed - "
            << uv_strerror(uv_last_error(uv_default_loop())));
    }
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
    delete req;
}

void
Nudp::connect_by_addr(struct addrinfo* res)
{
    LOG("Nudp::connect_by_addr: connecting to " << addrinfo2str(res));
    _utp_socket = utp_create_socket(Nudp::_utp_ctx);
    // utp_set_userdata(_utp_socket, this);
    utp_connect(_utp_socket, res->ai_addr, res->ai_addrlen);
    start_receiving();
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
    LOG("Nudp::send: buffer length " << m->len);
    self.try_write_data();
    NAN_RETURN(Nan::Undefined());
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
    LOG("Nudp::put_read_data: put buffer of length " << len);
    Nan::HandleScope scope;
    while (len > 0) {
        if (!_incoming_msg.handled_len) {
            if (len < 4) {
                PANIC("SHORT UTP READ OF MSG LEN");
            }
            uint32_t msg_len = ntohl(reinterpret_cast<const uint32_t*>(buf)[0]);
            LOG("Nudp::put_read_data: new incoming message of length " << msg_len);
            v8::Local<v8::Object> node_buf = Nan::NewBuffer(msg_len).ToLocalChecked();
            _incoming_msg.len = msg_len;
            _incoming_msg.data = node::Buffer::Data(node_buf);
            _incoming_msg.persistent.Reset(node_buf);
            _incoming_msg.handled_len = true;
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
            v8::Local<v8::Object> node_buf = Nan::New(_incoming_msg.persistent);
            _incoming_msg.persistent.Reset();
            _incoming_msg.data = 0;
            _incoming_msg.handled_len = false;
            LOG("Nudp::put_read_data: incoming message completed of length "
                << node::Buffer::Length(node_buf));
            v8::Local<v8::Value> argv[2] = { NAN_STR("message"), node_buf };
            Nan::MakeCallback(Nan::New(handle()), "emit", 2, argv);
        }
    }
}

void
Nudp::start_receiving()
{
    if (_receiving) {
        return;
    }
    _receiving = true;
    if (uv_udp_recv_start(&_uv_udp_handle, &Nudp::uv_callback_alloc, &Nudp::uv_callback_receive)) {
        PANIC("Nudp::Nudp: uv_udp_recv_start failed -"
            << uv_strerror(uv_last_error(uv_default_loop())));
    }
}

// check for utp events in the uv loop
void
Nudp::uv_callback_timer(uv_timer_t* handle, int status)
{
    // LOG("Nudp::uv_callback_timer");
    Nudp& self = *reinterpret_cast<Nudp*>(handle->data);
    utp_issue_deferred_acks(self._utp_ctx);
    utp_check_timeouts(self._utp_ctx);
}

uv_buf_t
Nudp::uv_callback_alloc(uv_handle_t* handle, size_t suggested_size)
{
    LOG("Nudp::uv_callback_alloc: suggested_size " << suggested_size);
    return uv_buf_init(reinterpret_cast<char*>(malloc(suggested_size)), suggested_size);
}

void
Nudp::uv_callback_receive(
    uv_udp_t* handle,
    ssize_t nread,
    uv_buf_t buf,
    struct sockaddr* addr,
    unsigned flags)
{
    LOG("Nudp::uv_callback_receive: packet nread " << nread
        << " addr " << sockaddr2str(addr)
        << " flags " << flags);
    Nudp& self = *reinterpret_cast<Nudp*>(handle->data);
    const byte* data = reinterpret_cast<const byte*>(buf.base);
    hexdump(data, nread);
    if (flags & UV_UDP_PARTIAL) {
        LOG("Nudp::uv_callback_receive: Ignore truncated packet");
        return;
    }
    if (!addr) {
        LOG("Nudp::uv_callback_receive: Ignore packet without address");
        return;
    }
    if (!utp_process_udp(self._utp_ctx, data, nread, addr, sizeof(struct sockaddr))) {
        LOG("UDP packet not handled by UTP. Ignoring.");
    }
}

struct SendData
{
    char* buf;
    struct sockaddr_in sin;
};

uint64_t
Nudp::utp_callback_sendto(utp_callback_arguments *a)
{
    Nudp& self = *reinterpret_cast<Nudp*>(utp_context_get_userdata(a->context));
    uv_udp_send_t* req = new uv_udp_send_t;
    SendData* data = new SendData;
    req->data = data;
    data->buf = new char[a->len];
    memcpy(data->buf, a->buf, a->len);
    uv_buf_t buf = uv_buf_init(data->buf, a->len);
    data->sin = *reinterpret_cast<const struct sockaddr_in*>(a->address);
    LOG("Nudp::utp_callback_sendto: packet length " << a->len << " addr " << sockaddr2str(a->address));
    hexdump(a->buf, a->len);
    if (uv_udp_send(req, &self._uv_udp_handle, &buf, 1, data->sin, Nudp::uv_callback_send)) {
        PANIC("Nudp::utp_callback_sendto: uv_udp_send failed - "
            << uv_strerror(uv_last_error(uv_default_loop())));
    }
    return 0;
}

void
Nudp::uv_callback_send(uv_udp_send_t* req, int status)
{
    LOG("Nudp::uv_callback_send: status " << status);
    SendData* data = reinterpret_cast<SendData*>(req->data);
    delete[] data->buf;
    delete data;
    delete req;
}


uint64_t
Nudp::utp_callback_on_read(utp_callback_arguments *a)
{
    LOG("Nudp::utp_callback_on_read: buffer length " << a->len);
    Nudp& self = *reinterpret_cast<Nudp*>(utp_context_get_userdata(a->context));
    self.put_read_data(a->buf, a->len);
    utp_read_drained(a->socket);
    return 0;
}

uint64_t
Nudp::utp_callback_on_state_change(utp_callback_arguments *a)
{
    LOG("Nudp::utp_callback_on_state_change: state " <<
        utp_state_names[a->state] << " (" << a->state << ")");
    Nudp& self = *reinterpret_cast<Nudp*>(utp_context_get_userdata(a->context));
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
    Nudp& self = *reinterpret_cast<Nudp*>(utp_context_get_userdata(a->context));
    return 0;
}

uint64_t
Nudp::utp_callback_on_accept(utp_callback_arguments *a)
{
    LOG("Nudp::utp_callback_on_accept");
    Nudp& self = *reinterpret_cast<Nudp*>(utp_context_get_userdata(a->context));
    if (self._utp_socket) {
        PANIC("Nudp::utp_callback_on_accept: alredy connected or accepted");
    }
    self._utp_socket = a->socket;
    // utp_set_userdata(self._utp_socket, this);
    return 0;
}

uint64_t
Nudp::utp_callback_on_error(utp_callback_arguments *a)
{
    LOG("Nudp::utp_callback_on_error: " << utp_error_code_names[a->error_code]);
    Nudp& self = *reinterpret_cast<Nudp*>(utp_context_get_userdata(a->context));
    self.close();
    return 0;
}

uint64_t
Nudp::utp_callback_log(utp_callback_arguments *a)
{
    LOG("Nudp::utp_callback_log: " << a->buf);
    return 0;
}


static
std::string
addrinfo2str(const struct addrinfo* ai)
{
    if (!ai) return std::string("?:?");
    const struct sockaddr_in* sin = reinterpret_cast<const struct sockaddr_in*>(ai->ai_addr);
    return std::string(inet_ntoa(sin->sin_addr)) + ":" + std::to_string(ntohs(sin->sin_port));
}

static
std::string
sockaddr2str(const struct sockaddr* sa)
{
    if (!sa) return std::string("?:?");
    const struct sockaddr_in* sin = reinterpret_cast<const struct sockaddr_in*>(sa);
    return std::string(inet_ntoa(sin->sin_addr)) + ":" + std::to_string(ntohs(sin->sin_port));
}

static
void
hexdump(const void *p, size_t len)
{
    int count = 1;
    const char* pc = reinterpret_cast<const char*>(p);

    while (len--) {
        if (count == 1)
            fprintf(stderr, "    %p: ", pc);

        fprintf(stderr, " %02x", *pc++ & 0xff);

        if (count++ == 16) {
            fprintf(stderr, "\n");
            count = 1;
        }
    }

    if (count != 1)
        fprintf(stderr, "\n");
}
