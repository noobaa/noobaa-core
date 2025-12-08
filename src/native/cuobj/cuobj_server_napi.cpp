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
#include <protocol.h>

namespace noobaa
{

DBG_INIT(0);

typedef struct rdma_buffer RdmaBuf;

// helper struct for async RDMA event handling
// used in CuObjServerNapi::_handle_async_events()
struct AsyncEvent
{
    std::shared_ptr<Napi::Promise::Deferred> deferred;
    ssize_t size;
    uint16_t channel_id;
};

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
    void* _ptr;
    size_t _size;
    RdmaBuf* _rdma_buf;
    std::string _rdma_desc;
    uint64_t _rdma_addr;
    size_t _rdma_size;
    loff_t _rdma_offset;
    ssize_t _ret_size;
    thread_local static uint16_t _thread_channel_id;

    CuObjServerWorker(const Napi::CallbackInfo& info);
    virtual void Execute() override;
    virtual void OnOK() override;
};

Napi::FunctionReference CuObjServerNapi::constructor;
thread_local uint16_t CuObjServerWorker::_thread_channel_id = INVALID_CHANNEL_ID;
typedef Napi::External<RdmaBuf> ExternalRdmaBuf;

/**
 * @brief Create the N-API constructor for CuObjServerNapi and register its instance methods.
 *
 * @param env The N-API environment used to define the class.
 * @return Napi::Function The constructor function object for the CuObjServerNapi class.
 */
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
 * @brief Constructs a CuObjServerNapi wrapper and initializes the underlying cuObjServer.
 *
 * Initializes telemetry and logging, applies optional RDMA tunables, creates and connects
 * a cuObjServer instance, and prepares the internal libuv handle for optional async events.
 *
 * @param params JS object with initialization options:
 *  - ip: Server IP address to connect to.
 *  - port: Server port to connect to.
 *  - log_level: Optional log level; one of "ERROR", "INFO", or "DEBUG".
 *  - use_telemetry: Optional flag to enable telemetry output.
 *  - num_dcis: Optional RDMA tunable for number of DCIs.
 *  - cq_depth: Optional RDMA completion queue depth.
 *  - dc_key: Optional RDMA DC key.
 *  - ibv_poll_max_comp_event: Optional maximum completion events to poll.
 *  - service_level: Optional RDMA service level.
 *  - min_rnr_timer: Optional minimum RNR timer.
 *  - hop_limit: Optional RDMA hop limit.
 *  - pkey_index: Optional partition key index.
 *  - max_wr: Optional maximum work requests.
 *  - max_sge: Optional maximum scatter/gather entries.
 *  - delay_mode: Optional delay mode for RDMA operations.
 *  - delay_interval: Optional delay interval value.
 *
 * @throws Napi::Error If an unrecognized `log_level` is provided or if connecting to the server fails.
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
    if (params["log_level"].IsString()) {
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
    if (params["num_dcis"].IsNumber()) {
        rdma_params.setNumDcis(napi_get_i32(params, "num_dcis"));
    }
    if (params["cq_depth"].IsNumber()) {
        rdma_params.setCqDepth(napi_get_u32(params, "cq_depth"));
    }
    if (params["dc_key"].IsNumber()) {
        rdma_params.setDcKey(napi_get_i64(params, "dc_key"));
    }
    if (params["ibv_poll_max_comp_event"].IsNumber()) {
        rdma_params.setIbvPollMaxCompEv(napi_get_i32(params, "ibv_poll_max_comp_event"));
    }
    if (params["service_level"].IsNumber()) {
        rdma_params.setServiceLevel(napi_get_i32(params, "service_level"));
    }
    if (params["min_rnr_timer"].IsNumber()) {
        rdma_params.setMinRnrTimer(napi_get_i32(params, "min_rnr_timer"));
    }
    if (params["hop_limit"].IsNumber()) {
        rdma_params.setHopLimit(napi_get_u32(params, "hop_limit"));
    }
    if (params["pkey_index"].IsNumber()) {
        rdma_params.setPkeyIndex(napi_get_i32(params, "pkey_index"));
    }
    if (params["max_wr"].IsNumber()) {
        rdma_params.setMaxWr(napi_get_i32(params, "max_wr"));
    }
    if (params["max_sge"].IsNumber()) {
        rdma_params.setMaxSge(napi_get_i32(params, "max_sge"));
    }
    if (params["delay_mode"].IsNumber()) {
        rdma_params.setDelayMode(cuObjDelayMode_t(napi_get_i32(params, "delay_mode")));
    } else {
        // rdma_params.setDelayMode(CUOBJ_DELAY_NONE);
    }
    if (params["delay_interval"].IsNumber()) {
        rdma_params.setDelayInterval(napi_get_u32(params, "delay_interval"));
    } else {
        // rdma_params.setDelayInterval(0);
    }

    DBG0("CuObjServerNapi::ctor "
        << DVAL(ip) << DVAL(port) << DVAL(log_flags)
        << "num_dcis=" << rdma_params.getNumDcis() << " "
        << "cq_depth=" << rdma_params.getCqDepth() << " "
        << "dc_key=" << rdma_params.getDcKey() << " "
        << "ibv_poll_max_comp_event=" << rdma_params.getIbvPollMaxCompEv() << " "
        << "service_level=" << rdma_params.getServiceLevel() << " "
        << "min_rnr_timer=" << rdma_params.getMinRnrTimer() << " "
        << "hop_limit=" << rdma_params.getHopLimit() << " "
        << "pkey_index=" << rdma_params.getPkeyIndex() << " "
        << "max_wr=" << rdma_params.getMaxWr() << " "
        << "max_sge=" << rdma_params.getMaxSge() << " "
        << "delay_mode=" << rdma_params.getDelayMode() << " "
        << "delay_interval=" << rdma_params.getDelayInterval() << " ");

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

/**
 * @brief Stops async event polling and releases the underlying cuObjServer.
 *
 * Stops the libuv prepare handle used for async RDMA event polling and resets
 * the stored server shared pointer to free the cuObjServer instance.
 */
CuObjServerNapi::~CuObjServerNapi()
{
    DBG0("CuObjServerNapi::dtor");
    uv_prepare_stop(&_uv_async_handler);
    _server.reset();
}

/**
 * @brief Stop async event polling and close the wrapped CuObjServer instance.
 *
 * Stops the libuv prepare handler used for async RDMA events (if running),
 * releases the internal cuObjServer instance, and returns to JavaScript.
 *
 * @return Napi::Value JavaScript `undefined`.
 */
Napi::Value
CuObjServerNapi::close(const Napi::CallbackInfo& info)
{
    DBG0("CuObjServerNapi::close");
    uv_prepare_stop(&_uv_async_handler);
    _server.reset();
    return info.Env().Undefined();
}

/**
 * @brief Register a JavaScript Buffer for RDMA and attach an external RDMA handle to it.
 *
 * Attaches an External<RdmaBuf> to the provided Buffer (info[0]) using the internal buffer symbol.
 * If the Buffer already has an external RDMA handle attached, the call is a no-op. On failure to
 * allocate or register the RDMA handle, the function throws a Napi::Error.
 *
 * @param buf The JavaScript Buffer to register (passed as info[0]); its memory pointer and length are used.
 * @throws Napi::Error If the underlying RDMA buffer registration fails.
 *
 * Note: The attached RDMA handle must be explicitly released via deregister_buffer to avoid leaking
 * the RDMA registration handle.
 */
Napi::Value
CuObjServerNapi::register_buffer(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    auto buf = info[0].As<Napi::Buffer<uint8_t>>();
    void* ptr = buf.Data();
    size_t size = buf.Length();
    auto sym = _buffer_symbol.Value();

    // check if already registered and return so callers can easily lazy register any buffer
    if (buf.Get(sym).IsExternal()) {
        return env.Undefined();
    }

    RdmaBuf* rdma_buf = _server->registerBuffer(ptr, size);
    if (!rdma_buf) {
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerNapi::register_buffer Failed to register rdma buffer "
                   << DVAL(ptr) << DVAL(size));
    }

    // TODO add a finalizer to de-register on GC of the external, currently we need to manuall call de-register or we leak the RDMA handle
    buf.Set(sym, ExternalRdmaBuf::New(env, rdma_buf));
    return env.Undefined();
}

/**
 * @brief Deregisters an RDMA handle previously attached to a Node.js buffer.
 *
 * Removes the external RDMA buffer handle stored on the provided Buffer and
 * unregisters it from the underlying cuObjServer. The Buffer must have been
 * registered earlier via register_buffer().
 *
 * @param buf Node.js Buffer that holds the previously registered RDMA handle.
 *
 * @throws Napi::Error if the provided buffer does not have a registered RDMA handle.
 */
Napi::Value
CuObjServerNapi::deregister_buffer(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    auto buf = info[0].As<Napi::Buffer<uint8_t>>();
    void* ptr = buf.Data();
    size_t size = buf.Length();
    auto sym = _buffer_symbol.Value();

    if (!buf.Get(sym).IsExternal()) {
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerNapi::deregister_buffer No registered rdma buffer "
                   << DVAL(ptr) << DVAL(size));
    }

    auto rdma_buf = buf.Get(sym).As<ExternalRdmaBuf>().Data();
    _server->deRegisterBuffer(rdma_buf);

    buf.Delete(sym);
    return env.Undefined();
}

/**
 * @brief Checks whether the given Node.js Buffer has an external RDMA buffer handle attached.
 *
 * @param buf Node.js Buffer whose registration status will be checked.
 * @return bool `true` if the buffer has an external RDMA handle attached, `false` otherwise.
 */
Napi::Value
CuObjServerNapi::is_registered_buffer(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    auto buf = info[0].As<Napi::Buffer<uint8_t>>();
    auto sym = _buffer_symbol.Value();
    bool is_registered = buf.Get(sym).IsExternal();
    return Napi::Boolean::New(env, is_registered);
}

/**
 * @brief Dispatches a RDMA GET or PUT operation using the configured execution path.
 *
 * The method reads operation parameters from the provided callback info and either
 * invokes the async-event path or schedules a worker thread depending on the
 * instance configuration.
 *
 * @returns Napi::Value The JavaScript result of the RDMA operation (for example, the transferred byte count or an object describing completion status).
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

/**
 * @brief Constructs a worker that performs a CUOBJ GET or PUT RDMA operation.
 *
 * Parses and validates JavaScript arguments (operation type, key, local buffer,
 * and RDMA descriptor), initializes internal fields (buffer pointer/size,
 * RDMA descriptor, address, size, offset, and registered RdmaBuf), and prepares
 * the worker for Execute().
 *
 * Expected arguments in `info`:
 *  - [0] op_type: string "GET" or "PUT".
 *  - [1] op_key: string key for the object operation.
 *  - [2] Buffer<uint8_t>: local buffer previously registered with the server.
 *  - [3] rdma_info: object with properties:
 *      - desc: string RDMA descriptor (must match RDMA_DESC_STR length).
 *      - addr: string RDMA address (hex).
 *      - size: number RDMA buffer size (positive).
 *      - offset: number RDMA offset (>= 0).
 *
 * @param info N-API callback info containing the arguments described above.
 *
 * @throws Napi::Error if:
 *  - op_type is not "GET" or "PUT";
 *  - RDMA descriptor length is incorrect;
 *  - RDMA address is zero or cannot be parsed;
 *  - RDMA size is not greater than zero;
 *  - RDMA offset is negative;
 *  - the provided buffer does not have a registered external RdmaBuf.
 */
CuObjServerWorker::CuObjServerWorker(const Napi::CallbackInfo& info)
    : ObjectWrapWorker<CuObjServerNapi>(info)
    , _server(_wrap->_server)
    , _op_type(CUOBJ_INVALID)
    , _ptr(0)
    , _size(0)
    , _rdma_buf(0)
    , _rdma_addr(0)
    , _rdma_size(0)
    , _rdma_offset(0)
    , _ret_size(-1)
{
    auto env = info.Env();
    auto op_type = info[0].As<Napi::String>().Utf8Value();
    _op_key = info[1].As<Napi::String>().Utf8Value();
    auto buf = info[2].As<Napi::Buffer<uint8_t>>();
    auto rdma_info = info[3].As<Napi::Object>();

    _rdma_desc = rdma_info.Get("desc").As<Napi::String>().Utf8Value();
    auto rdma_addr = rdma_info.Get("addr").As<Napi::String>().Utf8Value();
    auto rdma_size = rdma_info.Get("size").As<Napi::Number>().Int64Value();
    _rdma_offset = rdma_info.Get("offset").As<Napi::Number>().Int64Value();

    if (op_type == "GET") {
        _op_type = CUOBJ_GET;
    } else if (op_type == "PUT") {
        _op_type = CUOBJ_PUT;
    } else {
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerWorker: bad op type " << DVAL(op_type));
    }

    _ptr = buf.Data();
    _size = buf.Length();
    _rdma_addr = strtoull(rdma_addr.c_str(), 0, 16);
    _rdma_size = size_t(rdma_size);
    auto sym = _wrap->_buffer_symbol.Value();

    if (_rdma_desc.size() + 1 != sizeof RDMA_DESC_STR) {
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerWorker: bad rdma desc " << DVAL(_rdma_desc));
    }
    if (_rdma_addr == 0) {
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerWorker: bad rdma addr " << DVAL(rdma_addr) << DVAL(_rdma_addr));
    }
    if (rdma_size <= 0) {
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerWorker: bad rdma size " << DVAL(rdma_size));
    }
    if (_rdma_offset < 0) {
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerWorker: bad rdma offset " << DVAL(_rdma_offset));
    }
    if (!buf.Get(sym).IsExternal()) {
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerWorker: No registered rdma buffer " << DVAL(_ptr) << DVAL(_size));
    }

    _rdma_buf = buf.Get(sym).As<ExternalRdmaBuf>().Data();
}

/**
 * @brief Executes the configured RDMA GET or PUT operation and records the outcome.
 *
 * Computes the transfer size as the minimum of the local buffer size and the RDMA region size,
 * lazily allocates a thread-local channel id if one is not already assigned, and dispatches
 * the operation to the wrapped server's GET or PUT handler. The number of bytes transferred
 * or a negative error code is stored in `_ret_size`. On channel allocation failure or when the
 * server reports an error, the worker's error state is set via `SetError`.
 */
void
CuObjServerWorker::Execute()
{
    DBG1("CuObjServerWorker: Execute "
        << DVAL(_op_type)
        << DVAL(_op_key)
        << DVAL(_ptr)
        << DVAL(_size)
        << DVAL(_rdma_buf)
        << DVAL(_rdma_desc)
        << DVAL(_rdma_addr)
        << DVAL(_rdma_size)
        << DVAL(_rdma_offset));

    size_t real_size = std::min(_size, _rdma_size);

    // lazy allocate channel id and keep it in thread local storage
    // we currently do not free those channel ids
    if (_thread_channel_id == INVALID_CHANNEL_ID) {
        _thread_channel_id = _server->allocateChannelId();
        if (_thread_channel_id == INVALID_CHANNEL_ID) {
            SetError(XSTR() << "CuObjServerWorker: Failed to allocate channel id");
            return;
        }
    }

    if (_op_type == CUOBJ_GET) {
        _ret_size = _server->handleGetObject(
            _op_key, _rdma_buf, _rdma_addr, real_size, _rdma_desc, _thread_channel_id);
    } else if (_op_type == CUOBJ_PUT) {
        _ret_size = _server->handlePutObject(
            _op_key, _rdma_buf, _rdma_addr, real_size, _rdma_desc, _thread_channel_id);
    } else {
        PANIC("bad op type " << DVAL(_op_type));
    }

    if (_ret_size < 0) {
        SetError(XSTR() << "CuObjServerWorker: op failed "
                        << DVAL(_op_type) << DVAL(_ret_size));
    }
}

/**
 * @brief Resolve the worker's JavaScript promise with the operation result size.
 *
 * Converts the worker's internal return size into a JavaScript Number and resolves
 * the associated Promise with that value.
 */
void
CuObjServerWorker::OnOK()
{
    _promise.Resolve(Napi::Number::New(Env(), _ret_size));
}

/**
 * @brief Initiates an RDMA GET or PUT operation using an allocated async channel.
 *
 * Expects JS arguments: opType ("GET" or "PUT"), key (object key), buffer (registered RDMA Buffer),
 * and rdmaInfo object with fields `{ desc, addr, size, offset }`. Validates descriptor, address,
 * size, offset, and that the buffer has a registered external RDMA handle, allocates a channel,
 * queues the RDMA operation with the server, and starts libuv-based polling for completion.
 *
 * @param info N-API callback info containing the four arguments described above.
 * @return Napi::Value A JavaScript Promise that resolves to the number of bytes transferred on
 *         successful completion or rejects with an error if the operation fails or validation fails.
 */
Napi::Value
CuObjServerNapi::rdma_async_event(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    auto op_type = info[0].As<Napi::String>().Utf8Value();
    auto op_key = info[1].As<Napi::String>().Utf8Value();
    auto buf = info[2].As<Napi::Buffer<uint8_t>>();
    auto sym = _buffer_symbol.Value();
    auto rdma_info = info[3].As<Napi::Object>();
    auto rdma_desc = rdma_info.Get("desc").As<Napi::String>().Utf8Value();
    auto rdma_addr = rdma_info.Get("addr").As<Napi::String>().Utf8Value();
    auto rdma_size = rdma_info.Get("size").As<Napi::Number>().Int64Value();
    auto rdma_offset = rdma_info.Get("offset").As<Napi::Number>().Int64Value();

    void* ptr = buf.Data();
    size_t size = buf.Length();
    size_t real_size = std::min(size, size_t(rdma_size));
    uint64_t remote_addr = strtoull(rdma_addr.c_str(), 0, 16);

    if (rdma_desc.size() + 1 != sizeof RDMA_DESC_STR) {
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerNapi: bad rdma desc " << DVAL(rdma_desc));
    }
    if (remote_addr == 0) {
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerNapi: bad rdma addr " << DVAL(remote_addr) << DVAL(rdma_addr));
    }
    if (rdma_size <= 0) {
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerNapi: bad rdma size " << DVAL(rdma_size));
    }
    if (rdma_offset < 0) {
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerNapi: bad rdma offset " << DVAL(rdma_offset));
    }
    if (!buf.Get(sym).IsExternal()) {
        throw Napi::Error::New(env,
            XSTR() << "CuObjServerNapi: No registered rdma buffer " << DVAL(ptr) << DVAL(size));
    }
    auto rdma_buf = buf.Get(sym).As<ExternalRdmaBuf>().Data();

    uint16_t channel_id = _server->allocateChannelId();
    auto deferred = std::make_shared<Napi::Promise::Deferred>(env);
    auto async_event = std::make_unique<AsyncEvent>(deferred, real_size, channel_id);

    // LOG("CuObjServerNapi: queue async event " << DVAL(deferred.get()) << DVAL(_num_pending) << DVAL(size));
    int r = 0;
    ibv_wc_status status = IBV_WC_SUCCESS;
    if (op_type == "GET") {
        r = _server->handleGetObject(
            op_key, rdma_buf, remote_addr, real_size, rdma_desc, channel_id, 0, &status, async_event.get());
    } else if (op_type == "PUT") {
        r = _server->handlePutObject(
            op_key, rdma_buf, remote_addr, real_size, rdma_desc, channel_id, 0, &status, async_event.get());
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

/**
 * @brief Libuv prepare callback that forwards event handling to the associated CuObjServerNapi instance.
 *
 * The provided `uv_prepare_t` handle is expected to have its `data` field set to a pointer
 * to a `CuObjServerNapi` instance; this function casts that pointer and invokes the
 * instance method that processes pending async RDMA events.
 *
 * @param handle Pointer to the libuv prepare handle whose `data` is a `CuObjServerNapi*`.
 */
static void
_uv_handle_async_events(uv_prepare_t* handle)
{
    static_cast<CuObjServerNapi*>(handle->data)->_handle_async_events();
}

/**
 * @brief Start libuv preparation handler for polling RDMA async events.
 *
 * Starts the uv_prepare handle used to poll and process pending asynchronous
 * RDMA events when there are registered async channels to monitor.
 */
void
CuObjServerNapi::_start_async_events()
{
    if (_async_channels.empty()) {
        uv_prepare_start(&_uv_async_handler, _uv_handle_async_events);
    }
}

/**
 * @brief Stop the libuv prepare handler when there are no pending async channels.
 *
 * If the internal set of pending asynchronous channel IDs is empty, stops the
 * associated uv_prepare_t handler to cease polling for async RDMA events.
 */
void
CuObjServerNapi::_stop_async_events()
{
    if (_async_channels.empty()) {
        uv_prepare_stop(&_uv_async_handler);
    }
}

// handler called from the uv event loop to poll for rdma async events
// it checks all the channels that have pending async events
/**
 * @brief Polls pending RDMA async channels and completes their associated promises.
 *
 * For each channel tracked in the internal async set, polls the server for a completion event;
 * when an event is available, resolves the associated JavaScript promise with the completed
 * transfer size or rejects it with an error, frees the channel id, and removes the channel from
 * the pending set. After processing, stops the libuv prepare handler if there are no remaining
 * async channels.
 */
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
        assert(num_events == 1);
        auto async_event = std::unique_ptr<AsyncEvent>(static_cast<AsyncEvent*>(poll_event.async_handle));
        assert(async_event->channel_id == channel_id);
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

/**
 * @brief Register the CuObjServerNapi JavaScript class on the given module exports.
 *
 * Attaches the N-API constructor returned by CuObjServerNapi::Init to the provided
 * exports object under the name "CuObjServerNapi" and logs library load.
 *
 * @param env The N-API environment.
 * @param exports The module exports object to which the class will be added.
 */
void
cuobj_server_napi(Napi::Env env, Napi::Object exports)
{
    exports["CuObjServerNapi"] = CuObjServerNapi::Init(env);
    DBG0("CUOBJ: server library loaded.");
}

} // namespace noobaa