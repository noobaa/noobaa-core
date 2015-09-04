#include "nudp.h"

Nan::Persistent<v8::Function> Nudp::_ctor;
utp_context *Nudp::_utp_ctx;

NAN_MODULE_INIT(Nudp::setup)
{
    auto name = "Nudp";
    auto tpl = Nan::New<v8::FunctionTemplate>(Nudp::new_instance);
    tpl->SetClassName(NAN_STR(name));
    tpl->InstanceTemplate()->SetInternalFieldCount(1);
    Nan::SetPrototypeMethod(tpl, "send", Nudp::send);
    Nan::SetPrototypeMethod(tpl, "close", Nudp::close);
    auto func = Nan::GetFunction(tpl).ToLocalChecked();
    _ctor.Reset(func);
    NAN_SET(target, name, func);

    _utp_ctx = utp_init(2); // version=2
	utp_set_callback(_utp_ctx, UTP_SENDTO,           &callback_sendto);
	utp_set_callback(_utp_ctx, UTP_ON_READ,		     &callback_on_read);
	utp_set_callback(_utp_ctx, UTP_ON_STATE_CHANGE,  &callback_on_state_change);
	utp_set_callback(_utp_ctx, UTP_ON_FIREWALL,      &callback_on_firewall);
	utp_set_callback(_utp_ctx, UTP_ON_ACCEPT,		 &callback_on_accept);
	utp_set_callback(_utp_ctx, UTP_ON_ERROR,		 &callback_on_error);
    utp_set_callback(_utp_ctx, UTP_LOG,              &callback_log);
}

NAN_METHOD(Nudp::new_instance)
{
    NAN_MAKE_CTOR_CALL(_ctor);
    Nudp* obj = new Nudp();
    obj->Wrap(info.This());
    info.GetReturnValue().Set(info.This());
}

NAN_METHOD(Nudp::send)
{
    Nudp& self = *NAN_UNWRAP_THIS(Nudp);

    if (info.Length() < 1) {
        NAN_RETURN(Nan::Undefined());
    }
    v8::Local<v8::Object> buffer = Nan::To<v8::Object>(info[0]).ToLocalChecked();
    Message* m = new Message;
    m->persistent.Reset(buffer);
    m->callback.reset(new Nan::Callback(info[1].As<v8::Function>()));
    m->data = node::Buffer::Data(buffer);
    m->len = node::Buffer::Length(buffer);
    m->pos = 0;
    _write_queue.push_back(m);

    self.try_write_data();

    NAN_RETURN(Nan::Undefined());
}

NAN_METHOD(Nudp::close)
{
    Nudp& self = *NAN_UNWRAP_THIS(Nudp);
    self.close();
    NAN_RETURN(Nan::Undefined());
}

uint64_t
Nudp::callback_sendto(utp_callback_arguments *a)
{
    LOG("Nudp::callback_sendto");
    Nudp* self = static_cast<Nudp*>(utp_get_userdata(a->socket));
    uv_buf_t buf = uv_buf_init(reinterpret_cast<char*>(const_cast<uint8_t*>(a->buf)), a->len);
    // struct sockaddr_in *sin = (struct sockaddr_in *) a->address;
    uv_udp_try_send(&self->_udp_handle, &buf, 1, a->address);
    return 0;
}

uint64_t
Nudp::callback_on_read(utp_callback_arguments *a)
{
    LOG("Nudp::callback_on_read");
    Nudp* self = static_cast<Nudp*>(utp_get_userdata(a->socket));
    self->put_read_data(a->buf, a->len);
    utp_read_drained(a->socket);
	return 0;
}

uint64_t
Nudp::callback_on_state_change(utp_callback_arguments *a)
{
    LOG("Nudp::callback_on_state_change: state " <<
        utp_state_names[a->state] << " (" << a->state << ")");
    Nudp* self = static_cast<Nudp*>(utp_get_userdata(a->socket));
    utp_socket_stats *stats;

    switch (a->state) {
        case UTP_STATE_CONNECT:
        case UTP_STATE_WRITABLE:
            self->try_write_data();
            break;

        case UTP_STATE_EOF:
            LOG("Nudp::callback_on_state_change: EOF");
            self->close();
            break;

        case UTP_STATE_DESTROYING:
            LOG("Nudp::callback_on_state_change: destroying");
            stats = utp_get_stats(a->socket);
            if (stats) {
                LOG("Socket Statistics:");
                LOG("    Bytes sent:          " << stats->nbytes_xmit);
                LOG("    Bytes received:      " << stats->nbytes_recv);
                LOG("    Packets received:    " << stats->nrecv);
                LOG("    Packets sent:        " << stats->nxmit);
                LOG("    Duplicate receives:  " << stats->nduprecv);
                LOG("    Retransmits:         " << stats->rexmit);
                LOG("    Fast Retransmits:    " << stats->fastrexmit);
                LOG("    Best guess at MTU:   " << stats->mtu_guess);
            } else {
                LOG("No socket statistics available");
            }
            break;
    }

    return 0;
}

uint64_t
Nudp::callback_on_firewall(utp_callback_arguments *a)
{
    LOG("Nudp::callback_on_firewall");
    return 0;
}

uint64_t
Nudp::callback_on_accept(utp_callback_arguments *a)
{
    LOG("Nudp::callback_on_accept");
    return 0;
}

uint64_t
Nudp::callback_on_error(utp_callback_arguments *a)
{
    LOG("Nudp::callback_on_error " << utp_error_code_names[a->error_code]);
    Nudp* self = static_cast<Nudp*>(utp_get_userdata(a->socket));
    self->close();
	return 0;
}

uint64_t
Nudp::callback_log(utp_callback_arguments *a)
{
    LOG("Nudp::log " << a->buf);
	return 0;
}


Nudp::Nudp()
    : _utp_writable(false)
{
    LOG("Nudp::Nudp");
    _utp_socket = utp_create_socket(Nudp::_utp_ctx);
    utp_set_userdata(_utp_socket, this);
    uv_udp_init(uv_default_loop(), &_udp_handle);
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
    uv_close(reinterpret_cast<uv_handle_t*>(&_udp_handle), NULL);
    if (_utp_socket) {
        utp_close(_utp_socket);
        _utp_socket = NULL;
    }
}

void
Nudp::try_write_data()
{
    LOG("Nudp::try_write_data");
}

void
Nudp::put_read_data(const uint8_t *buf, int len)
{
    LOG("Nudp::put_read_data");
}
