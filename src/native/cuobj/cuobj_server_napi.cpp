/* Copyright (C) 2016 NooBaa */
#include "../util/common.h"
#include "../util/napi.h"
#include "../util/worker.h"
#include <set>
#include <uv.h>

// cuobj headers
typedef off_t loff_t;
struct rdma_buffer; // opaque handle returned by cuObjServer registerBuffer
#include <cuobjserver.h>

// Format of RDMA token string
// raddr:rsize:rkey:lid:qp:has_gid:gid ("%016lx:%08x:%08x:%04x:%06x:%01x:%016lx%016lx")
#define CUOBJ_DESC_STR "0102030405060708:01020304:01020304:0102:010203:1:0102030405060708090a0b0c0d0e0f10"

namespace noobaa
{

DBG_INIT(0);

typedef struct rdma_buffer RdmaBufHandle;
typedef Napi::External<RdmaBufHandle> NapiRdmaBufHandle;

/**
 * CuObjServerNapi is a node-api object wrapper for cuObjServer.
 */
struct CuObjServerNapi : public Napi::ObjectWrap<CuObjServerNapi>
{
    static Napi::FunctionReference constructor;
    std::shared_ptr<cuObjServer> _server;
    Napi::Reference<Napi::Symbol> _buffer_symbol;
    std::set<uint16_t> _async_channels;
    uv_prepare_t _uv_async_handler;
    bool _use_async_events = false;

    static Napi::Function Init(Napi::Env env);
    CuObjServerNapi(const Napi::CallbackInfo& info);
    ~CuObjServerNapi();
    Napi::Value close(const Napi::CallbackInfo& info);
    Napi::Value register_buffer(const Napi::CallbackInfo& info);
    Napi::Value deregister_buffer(const Napi::CallbackInfo& info);
    Napi::Value is_registered_buffer(const Napi::CallbackInfo& info);
    Napi::Value rdma(const Napi::CallbackInfo& info);
    Napi::Value rdma_async_event(const Napi::CallbackInfo& info);
    RdmaBufHandle* _register_server_buf(Napi::Env env, Napi::Buffer<uint8_t> buf);
    RdmaBufHandle* _get_server_buf_handle(Napi::Env env, Napi::Buffer<uint8_t> buf);
    void _start_async_events();
    void _stop_async_events();
    void _handle_async_events();
};

/**
 * CuObjServerWorker is a node-api worker for CuObjServerNapi::rdma()
 */
struct CuObjServerWorker : public ObjectWrapWorker<CuObjServerNapi>
{
    std::shared_ptr<cuObjServer> _server;
    cuObjOpType_t _op_type;
    std::string _op_key;
    std::string _client_buf_desc;
    loff_t _client_buf_offset;
    RdmaBufHandle* _server_buf_handle;
    void* _server_buf_ptr;
    size_t _server_buf_size;
    loff_t _server_buf_offset;
    size_t _max_size;
    ssize_t _ret_size;
    thread_local static uint16_t _thread_channel_id;

    CuObjServerWorker(const Napi::CallbackInfo& info);
    virtual void Execute() override;
    virtual void OnOK() override;
};

Napi::FunctionReference CuObjServerNapi::constructor;
thread_local uint16_t CuObjServerWorker::_thread_channel_id = INVALID_CHANNEL_ID;

// helper struct for async RDMA event handling
// used in CuObjServerNapi::_handle_async_events()
struct AsyncEvent
{
    Napi::ObjectReference server_ref;
    Napi::Reference<Napi::Buffer<uint8_t>> buf_ref;
    std::shared_ptr<Napi::Promise::Deferred> deferred;
    ssize_t size;
    uint16_t channel_id;

    AsyncEvent(
        Napi::ObjectReference&& server_ref_,
        Napi::Reference<Napi::Buffer<uint8_t>>&& buf_ref_,
        std::shared_ptr<Napi::Promise::Deferred> deferred_,
        ssize_t size_,
        uint16_t channel_id_)
        : server_ref(std::move(server_ref_))
        , buf_ref(std::move(buf_ref_))
        , deferred(deferred_)
        , size(size_)
        , channel_id(channel_id_)
    {
    }
};

Napi::Function
CuObjServerNapi::Init(Napi::Env env)
{
    constructor = Napi::Persistent(DefineClass(env,
        "CuObjServerNapi",
        {
            InstanceMethod<&CuObjServerNapi::close>("close"),
            InstanceMethod<&CuObjServerNapi::register_buffer>("register_buffer"),
            InstanceMethod<&CuObjServerNapi::deregister_buffer>("deregister_buffer"),
            InstanceMethod<&CuObjServerNapi::is_registered_buffer>("is_registered_buffer"),
            InstanceMethod<&CuObjServerNapi::rdma>("rdma"),
        }));
    constructor.SuppressDestruct();
    return constructor.Value();
}

/**
 * @param {{
 *      ip: string,
 *      port: number,
 *      log_level?: 'ERROR'|'INFO'|'DEBUG',
 *      use_telemetry?: boolean,
 *      use_async_events?: boolean,
 *      num_dcis?: number,
 *      cq_depth?: number,
 *      dc_key?: number,
 *      ibv_poll_max_comp_event?: number,
 *      service_level?: number,
 *      hop_limit?: number,
 *      pkey_index?: number,
 *      max_wr?: number,
 *      max_sge?: number,
 *      delay_mode?: number,
 *      delay_interval?: number,
 *      qp_reset_on_failure?: boolean,
 *      retry_count?: number
 * }} params = info[0]
 */
CuObjServerNapi::CuObjServerNapi(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<CuObjServerNapi>(info)
{
    auto env = info.Env();
    const Napi::Object params = info[0].As<Napi::Object>();
    std::string ip = napi_get_str(params, "ip");
    unsigned short port = napi_get_u32(params, "port");

    bool use_telemetry = params["use_telemetry"].ToBoolean();
    uint32_t log_flags = 0;
    if (napi_is_defined(params["log_level"])) {
        std::string log_level = napi_get_str(params, "log_level");
        if (log_level == "DEBUG") {
            log_flags |= CUOBJ_LOG_PATH_ERROR;
            log_flags |= CUOBJ_LOG_PATH_INFO;
            log_flags |= CUOBJ_LOG_PATH_DEBUG;
        } else if (log_level == "INFO") {
            log_flags |= CUOBJ_LOG_PATH_ERROR;
            log_flags |= CUOBJ_LOG_PATH_INFO;
        } else if (log_level == "ERROR") {
            log_flags |= CUOBJ_LOG_PATH_ERROR;
        } else {
            throw Napi::Error::New(env,
                XSTR() << "CuObjServerNapi::ctor bad " << DVAL(log_level));
        }
    }

    cuObjRDMATunable rdma_params;
    if (napi_is_defined(params, "num_dcis")) {
        rdma_params.setNumDcis(napi_get_i32(params, "num_dcis"));
    }
    if (napi_is_defined(params, "cq_depth")) {
        rdma_params.setCqDepth(napi_get_u32(params, "cq_depth"));
    }
    if (napi_is_defined(params, "dc_key")) {
        rdma_params.setDcKey(napi_get_i64(params, "dc_key"));
    }
    if (napi_is_defined(params, "ibv_poll_max_comp_event")) {
        rdma_params.setIbvPollMaxCompEv(napi_get_i32(params, "ibv_poll_max_comp_event"));
    }
    if (napi_is_defined(params, "service_level")) {
        rdma_params.setServiceLevel(napi_get_i32(params, "service_level"));
    }
    if (napi_is_defined(params, "hop_limit")) {
        rdma_params.setHopLimit(napi_get_u32(params, "hop_limit"));
    }
    if (napi_is_defined(params, "pkey_index")) {
        rdma_params.setPkeyIndex(napi_get_i32(params, "pkey_index"));
    }
    if (napi_is_defined(params, "max_wr")) {
        rdma_params.setMaxWr(napi_get_i32(params, "max_wr"));
    }
    if (napi_is_defined(params, "max_sge")) {
        rdma_params.setMaxSge(napi_get_i32(params, "max_sge"));
    }
    if (napi_is_defined(params, "delay_mode")) {
        rdma_params.setDelayMode(cuObjDelayMode_t(napi_get_i32(params, "delay_mode")));
    }
    if (napi_is_defined(params, "delay_interval")) {
        rdma_params.setDelayInterval(napi_get_u32(params, "delay_interval"));
    }
    if (napi_is_defined(params, "qp_reset_on_failure")) {
        rdma_params.setQPResetOnFailure(params["qp_reset_on_failure"].ToBoolean());
    }
    if (napi_is_defined(params, "retry_count")) {
        rdma_params.setRetryCount(napi_get_u32(params, "retry_count"));
    }

    DBG0("CuObjServerNapi::ctor "
        << DVAL(ip) << DVAL(port) << DVAL(log_flags)
        << "num_dcis=" << rdma_params.getNumDcis() << " "
        << "cq_depth=" << rdma_params.getCqDepth() << " "
        << "dc_key=" << rdma_params.getDcKey() << " "
        << "ibv_poll_max_comp_event=" << rdma_params.getIbvPollMaxCompEv() << " "
        << "service_level=" << rdma_params.getServiceLevel() << " "
        << "hop_limit=" << rdma_params.getHopLimit() << " "
        << "pkey_index=" << rdma_params.getPkeyIndex() << " "
        << "max_wr=" << rdma_params.getMaxWr() << " "
        << "max_sge=" << rdma_params.getMaxSge() << " "
        << "delay_mode=" << rdma_params.getDelayMode() << " "
        << "delay_interval=" << rdma_params.getDelayInterval() << " "
        << "qp_reset_on_failure=" << rdma_params.getQPResetOnFailure() << " "
        << "retry_count=" << rdma_params.getRetryCount() << " ");

    cuObjServer::setupTelemetry(use_telemetry, &std::cout);
    cuObjServer::setTelemFlags(log_flags);

    std::shared_ptr<cuObjServer> server(new cuObjServer(
        ip.c_str(), port, CUOBJ_PROTO_RDMA_DC_V1, rdma_params));

    if (!server->isConnected()) {
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerNapi::ctor connect failed " << DVAL(ip) << DVAL(port));
    }

    _server = server;
    _buffer_symbol = Napi::Persistent(Napi::Symbol::New(env, "CuObjServerNapiBufferSymbol"));

    // NOTE: initial tests of async events mode showed that it is slower than using worker threads, so keep it disabled by default
    _use_async_events = params["use_async_events"].ToBoolean();
    _uv_async_handler.data = this;
    uv_prepare_init(uv_default_loop(), &_uv_async_handler);
}

CuObjServerNapi::~CuObjServerNapi()
{
    DBG0("CuObjServerNapi::dtor");
    uv_prepare_stop(&_uv_async_handler);
    _server.reset();
}

Napi::Value
CuObjServerNapi::close(const Napi::CallbackInfo& info)
{
    DBG0("CuObjServerNapi::close");
    uv_prepare_stop(&_uv_async_handler);
    _server.reset();
    return info.Env().Undefined();
}

/**
 * Register a buffer for RDMA and get an rdma_buf handle.
 * The handle is stored in the buffer object as an external reference.
 * This allows any buffer to be registered lazily and get the handle
 * from the buffer when needed.
 */
RdmaBufHandle*
CuObjServerNapi::_register_server_buf(Napi::Env env, Napi::Buffer<uint8_t> buf)
{
    auto sym = _buffer_symbol.Value();
    auto ext = buf.Get(sym);
    void* ptr = buf.Data();
    size_t size = buf.Length();

    // return if already registered so callers can be lazy
    if (ext.IsExternal()) {
        auto buf_handle = ext.As<NapiRdmaBufHandle>().Data();
        return buf_handle;
    }

    auto buf_handle = _server->registerBuffer(ptr, size);
    if (!buf_handle) {
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerNapi: registerBuffer failed "
                   << DVAL(ptr) << DVAL(size));
    }

    // store the local_buf handle in and external object on the buffer
    // deregister using a finalizer which will be called on GC
    // capture server shared_ptr to keep it alive until finalizer is called
    auto ext_new = NapiRdmaBufHandle::New(
        env,
        buf_handle,
        [server = _server, ptr, size](Napi::Env env, RdmaBufHandle* buf_handle) {
            DBG1("CuObjServerNapi: finalize buffer "
                << DVAL(ptr) << DVAL(size) << DVAL(buf_handle));
            server->deRegisterBuffer(buf_handle);
        });

    buf.Set(sym, ext_new);
    return buf_handle;
}

/**
 * Register a buffer for RDMA and get an rdma_buf handle.
 * The handle is stored in the buffer object as an external reference.
 * This allows any buffer to be registered lazily and get the handle
 * from the buffer when needed.
 */
RdmaBufHandle*
CuObjServerNapi::_get_server_buf_handle(Napi::Env env, Napi::Buffer<uint8_t> buf)
{
    auto sym = _buffer_symbol.Value();
    auto ext = buf.Get(sym);
    void* ptr = buf.Data();
    size_t size = buf.Length();

    if (!ext.IsExternal()) {
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerNapi: server buffer not registered "
                   << DVAL(ptr) << DVAL(size));
    }

    auto buf_handle = ext.As<NapiRdmaBufHandle>().Data();
    return buf_handle;
}


/**
 * @param {Buffer} buf = info[0]
 */
Napi::Value
CuObjServerNapi::register_buffer(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    auto buf = info[0].As<Napi::Buffer<uint8_t>>();
    _register_server_buf(env, buf);
    return env.Undefined();
}

/**
 * @param {Buffer} buf = info[0]
 */
Napi::Value
CuObjServerNapi::deregister_buffer(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    Napi::HandleScope scope(env);
    auto buf = info[0].As<Napi::Buffer<uint8_t>>();
    auto sym = _buffer_symbol.Value();
    auto ext = buf.Get(sym);

    if (ext.IsExternal()) {
        // delete the symbol to allow the finalizer of ext to run.
        // however gc is not immediate so the actual deregister may be delayed.
        buf.Delete(sym);

        // TODO(guym) - can we call deRegisterBuffer here?
        // we can't disable the finalizer from getting called on gc
        // which will call deRegisterBuffer again... depends if cuObjServer
        // can handle double deregister of the same buffer.

        // auto buf_handle = ext.As<NapiRdmaBufHandle>().Data();
        // _server->deRegisterBuffer(buf_handle);
    }

    return env.Undefined();
}

/**
 * @param {Buffer} buf = info[0]
 * @returns {boolean}
 */
Napi::Value
CuObjServerNapi::is_registered_buffer(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    auto buf = info[0].As<Napi::Buffer<uint8_t>>();
    auto sym = _buffer_symbol.Value();
    auto ext = buf.Get(sym);
    return Napi::Boolean::New(env, ext.IsExternal());
}

/**
 * async function to start and await a CuObjServerWorker threadpool worker
 *
 * @param {'GET' | 'PUT'} op_type = info[0]
 * @param {string} op_key = info[1]
 * @param {string} client_buf_desc = info[2]
 * @param {number} client_buf_offset = info[3]
 * @param {Buffer} server_buf = info[4]
 * @param {number} server_buf_offset = info[5]
 * @param {number} max_size = info[6]
 * @returns {Promise<number>} - resolves to the real size of the RDMA transfer
 */
Napi::Value
CuObjServerNapi::rdma(const Napi::CallbackInfo& info)
{
    if (_use_async_events) {
        return rdma_async_event(info);
    } else {
        return await_worker<CuObjServerWorker>(info);
    }
}

static cuObjOpType_t
parse_op_type(const std::string& op_type_str)
{
    if (op_type_str == "GET") {
        return CUOBJ_GET;
    } else if (op_type_str == "PUT") {
        return CUOBJ_PUT;
    } else {
        return CUOBJ_INVALID;
    }
}

CuObjServerWorker::CuObjServerWorker(const Napi::CallbackInfo& info)
    : ObjectWrapWorker<CuObjServerNapi>(info)
    , _server(_wrap->_server)
    , _op_type(CUOBJ_INVALID)
    , _client_buf_offset(0)
    , _server_buf_handle(0)
    , _server_buf_ptr(0)
    , _server_buf_size(0)
    , _server_buf_offset(0)
    , _max_size(0)
    , _ret_size(-1)
{
    auto env = info.Env();

    _op_type = parse_op_type(napi_get_str(info[0]));
    _op_key = napi_get_str(info[1]);
    if (_op_type != CUOBJ_GET && _op_type != CUOBJ_PUT) {
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerNapi: bad op type " << DVAL(_op_type));
    }
    _client_buf_desc = napi_get_str(info[2]);
    _client_buf_offset = napi_is_defined(info[3]) ? napi_get_i64(info[3]) : 0;
    auto server_buf = info[4].As<Napi::Buffer<uint8_t>>();
    _server_buf_ptr = server_buf.Data();
    _server_buf_size = server_buf.Length();
    _server_buf_handle = _wrap->_get_server_buf_handle(env, server_buf);
    _server_buf_offset = napi_is_defined(info[5]) ? napi_get_i64(info[5]) : 0;
    _max_size = napi_get_i64(info[6]);

    if (_client_buf_desc.size() + 1 != sizeof CUOBJ_DESC_STR) {
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerNapi: bad client desc " << DVAL(_client_buf_desc));
    }
    if (_client_buf_offset < 0) {
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerNapi: bad client offset " << DVAL(_client_buf_offset));
    }
    if (_server_buf_offset < 0 || size_t(_server_buf_offset) >= _server_buf_size) {
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerNapi: bad server offset " << DVAL(_server_buf_offset));
    }
    if (_max_size <= 0 || _max_size > _server_buf_size) {
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerNapi: bad max size " << DVAL(_max_size));
    }
}

void
CuObjServerWorker::Execute()
{
    DBG1("CuObjServerNapi: Worker "
        << DVAL(_op_type)
        << DVAL(_op_key)
        << DVAL(_client_buf_desc)
        << DVAL(_client_buf_offset)
        << DVAL(_server_buf_handle)
        << DVAL(_server_buf_ptr)
        << DVAL(_server_buf_size)
        << DVAL(_server_buf_offset)
        << DVAL(_max_size));

    // TODO(guym) - should we check the client buf desc rsize vs max_size?
    size_t real_size = std::min(_server_buf_size, _max_size);
    uint64_t client_buf_addr = strtoull(_client_buf_desc.c_str(), 0, 16);
    client_buf_addr += _client_buf_offset;

    // lazy allocate channel id and keep it in thread local storage.
    // we currently do not free those channel ids.
    // TODO(guym) for multiple servers in the same process we may need a map of server to channel id.
    if (_thread_channel_id == INVALID_CHANNEL_ID) {
        _thread_channel_id = _server->allocateChannelId();
        if (_thread_channel_id == INVALID_CHANNEL_ID) {
            SetError(XSTR() << "CuObjServerNapi: Failed to allocate channel id");
            return;
        }
    }

    if (_op_type == CUOBJ_GET) {
        _ret_size = _server->handleGetObject(
            _op_key, _server_buf_handle, client_buf_addr, real_size, _client_buf_desc, _thread_channel_id, _server_buf_offset);
    } else if (_op_type == CUOBJ_PUT) {
        _ret_size = _server->handlePutObject(
            _op_key, _server_buf_handle, client_buf_addr, real_size, _client_buf_desc, _thread_channel_id, _server_buf_offset);
    } else {
        PANIC("bad op type " << DVAL(_op_type));
    }

    if (_ret_size < 0) {
        SetError(XSTR() << "CuObjServerNapi: op failed "
                        << DVAL(_op_type) << DVAL(_ret_size));
    }
}

void
CuObjServerWorker::OnOK()
{
    _promise.Resolve(Napi::Number::New(Env(), _ret_size));
}

Napi::Value
CuObjServerNapi::rdma_async_event(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    auto op_type = parse_op_type(napi_get_str(info[0]));
    auto op_key = napi_get_str(info[1]);
    if (op_type != CUOBJ_GET && op_type != CUOBJ_PUT) {
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerWorker: bad op type " << DVAL(op_type));
    }
    auto client_buf_desc = napi_get_str(info[2]);
    auto client_buf_offset = napi_is_defined(info[3]) ? napi_get_i64(info[3]) : 0;
    auto server_buf = info[4].As<Napi::Buffer<uint8_t>>();
    auto server_buf_handle = _get_server_buf_handle(env, server_buf);
    // auto server_buf_ptr = server_buf.Data();
    auto server_buf_size = server_buf.Length();
    auto server_buf_offset = napi_is_defined(info[5]) ? napi_get_i64(info[5]) : 0;
    auto max_size = napi_get_i64(info[6]);

    if (client_buf_desc.size() + 1 != sizeof CUOBJ_DESC_STR) {
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerWorker: bad client desc " << DVAL(client_buf_desc));
    }
    if (client_buf_offset < 0) {
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerWorker: bad client offset " << DVAL(client_buf_offset));
    }
    if (server_buf_offset < 0 || size_t(server_buf_offset) >= server_buf_size) {
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerWorker: bad server offset " << DVAL(server_buf_offset));
    }
    if (max_size <= 0 || size_t(max_size) > server_buf_size) {
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerWorker: bad max length " << DVAL(max_size));
    }

    size_t real_size = std::min(server_buf_size, size_t(max_size));
    uint64_t client_buf_addr = strtoull(client_buf_desc.c_str(), 0, 16);
    client_buf_addr += client_buf_offset;

    uint16_t channel_id = _server->allocateChannelId();
    auto deferred = std::make_shared<Napi::Promise::Deferred>(env);
    auto async_event = std::make_unique<AsyncEvent>(
        Napi::Persistent(info.This().As<Napi::Object>()),
        Napi::Persistent(server_buf),
        deferred,
        real_size,
        channel_id);

    // LOG("CuObjServerNapi: queue async event " << DVAL(deferred.get()) << DVAL(_num_pending) << DVAL(size));
    int r = 0;
    ibv_wc_status status = IBV_WC_SUCCESS;
    if (op_type == CUOBJ_GET) {
        r = _server->handleGetObject(
            op_key, server_buf_handle, client_buf_addr, real_size, client_buf_desc, channel_id, server_buf_offset, &status, async_event.get());
    } else if (op_type == CUOBJ_PUT) {
        r = _server->handlePutObject(
            op_key, server_buf_handle, client_buf_addr, real_size, client_buf_desc, channel_id, server_buf_offset, &status, async_event.get());
    } else {
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerNapi: bad op type " << DVAL(op_type));
    }
    if (r < 0) {
        _server->freeChannelId(channel_id);
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerNapi: handle call error " << DVAL(r));
    } else {
        async_event.release();
        _start_async_events();
        _async_channels.insert(channel_id);
        return deferred->Promise();
    }
}

static void
_uv_handle_async_events(uv_prepare_t* handle)
{
    static_cast<CuObjServerNapi*>(handle->data)->_handle_async_events();
}

void
CuObjServerNapi::_start_async_events()
{
    if (_async_channels.empty()) {
        uv_prepare_start(&_uv_async_handler, _uv_handle_async_events);
    }
}

void
CuObjServerNapi::_stop_async_events()
{
    if (_async_channels.empty()) {
        uv_prepare_stop(&_uv_async_handler);
    }
}

// handler called from the uv event loop to poll for rdma async events
// it checks all the channels that have pending async events
// and completes the deferred promise.
void
CuObjServerNapi::_handle_async_events()
{
    // LOG("CuObjServerNapi::_handle_async_events " << DVAL(_async_channels.size()));
    for (auto it = _async_channels.begin(); it != _async_channels.end();) {
        uint16_t channel_id = *it;
        cuObjAsyncEvent_t poll_event = { nullptr, IBV_WC_SUCCESS };
        int num_events = _server->poll(&poll_event, 1, channel_id);
        if (num_events == 0) {
            ++it;
            continue;
        }
        if (num_events != 1 || !poll_event.async_handle) {
            PANIC("CuObjServerNapi::_handle_async_events unexpected events from poll " << DVAL(channel_id) << DVAL(num_events));
        }
        auto async_event = std::unique_ptr<AsyncEvent>(static_cast<AsyncEvent*>(poll_event.async_handle));
        if (async_event->channel_id != channel_id) {
            PANIC("CuObjServerNapi::_handle_async_events unexpected channel_id from poll " << DVAL(channel_id) << DVAL(async_event->channel_id));
        }

        auto deferred = async_event->deferred;
        auto env = deferred->Env();
        Napi::HandleScope scope(env);
        // LOG("CuObjServerNapi::_handle_async_events complete " << DVAL(deferred.get()) << DVAL(event.status));
        if (poll_event.status != IBV_WC_SUCCESS) {
            auto err = Napi::Error::New(env,
                XSTR() << "CuObjServerNapi: op failed " << DVAL(poll_event.status));
            deferred->Reject(err.Value());
        } else {
            deferred->Resolve(Napi::Number::New(env, async_event->size));
        }
        _server->freeChannelId(channel_id);
        it = _async_channels.erase(it); // erase and advance
    }
    _stop_async_events();
}

void
cuobj_server_napi(Napi::Env env, Napi::Object exports)
{
    exports["CuObjServerNapi"] = CuObjServerNapi::Init(env);
    DBG0("CUOBJ: server library loaded.");
}

} // namespace noobaa
