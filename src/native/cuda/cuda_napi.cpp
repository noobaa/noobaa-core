/* Copyright (C) 2016 NooBaa */
#include "../util/common.h"
#include "../util/napi.h"
#include "../util/worker.h"
#include <cuda.h>

#define CU_TRY(fn)                                    \
    do {                                              \
        CUresult r = fn;                              \
        if (r != CUDA_SUCCESS) {                      \
            const char* cuda_err = "";                \
            cuGetErrorName(r, &cuda_err);             \
            throw Napi::Error::New(env,               \
                XSTR() << __func__ << " " #fn " "     \
                       << DVAL(r) << DVAL(cuda_err)); \
        }                                             \
    } while (0)

#define CU_WARN(fn)                            \
    do {                                       \
        CUresult r = fn;                       \
        if (r != CUDA_SUCCESS) {               \
            const char* cuda_err = "";         \
            cuGetErrorName(r, &cuda_err);      \
            LOG("WARNING: "                    \
                << __func__ << " " #fn " "     \
                << DVAL(r) << DVAL(cuda_err)); \
        }                                      \
    } while (0)

#define CUDA_TRY(fn)                                    \
    do {                                                \
        cudaError_t r = fn;                             \
        if (r != cudaSuccess) {                         \
            const char* cuda_err = cudaGetErrorName(r); \
            throw Napi::Error::New(env,                 \
                XSTR() << __func__ << " " #fn " "       \
                       << DVAL(r) << DVAL(cuda_err));   \
        }                                               \
    } while (0)

namespace noobaa
{

DBG_INIT(1);

CUdevice cuda_napi_dev_num = -1;
CUdevice cuda_napi_dev = -1;
CUcontext cuda_napi_ctx = 0;

// About cuda context management:
// read this most helpful answer - https://forums.developer.nvidia.com/t/cuda-context-and-threading/26625/6
// Main points:
//  1) a context belongs to a single device.
//  2) a thread has a single context bound at a time (ignoring context stack stuff)
//  3) a context can be bound to multiple threads simultaneously
// so we use the primary context on each device and bind it to our worker threads.
/**
 * @brief Ensure a CUDA context is initialized and bound for the current process and worker threads.
 *
 * Initializes CUDA for the specified device (if not already initialized for that device), retains
 * the device's primary context, sets that context as current, and updates internal globals so
 * other native threads (including cuobj_client worker threads) can use the same CUDA context.
 *
 * @param env N-API environment (unused by this function but provided for call sites that have it).
 * @param dev_num Device ordinal to initialize and bind the context for. Defaults to 0.
 *
 * @throws Napi::Error If any CUDA driver API call fails during initialization or context binding.
 */
static void
cuda_napi_ctx_init(Napi::Env env, int dev_num = 0)
{
    if (cuda_napi_dev_num == dev_num && cuda_napi_ctx) return;

    CUdevice dev = -1;
    CUcontext ctx = 0;

    CU_TRY(cuInit(0));
    CU_TRY(cuDeviceGet(&dev, dev_num));

    CU_TRY(cuDevicePrimaryCtxRetain(&ctx, dev));
    CU_TRY(cuCtxSetCurrent(ctx));

    cuda_napi_dev_num = dev_num;
    cuda_napi_dev = dev;
    cuda_napi_ctx = ctx;

    // rdma_napi needs worker threads to set the cuda context
    // and since we depend on rdma_napi we set the context here.
    extern CUcontext cuobj_client_napi_cuda_ctx;
    cuobj_client_napi_cuda_ctx = ctx;

    LOG("cuda_napi_ctx_init " << DVAL(dev_num) << DVAL(dev) << DVAL(ctx));
}

/**
 * Helper class for CudaMemory
 * Represents a slice of CUDA device memory that can be sub-sliced.
 */
struct CudaSlice
{
    CUdeviceptr ptr;
    size_t size;

    /**
     * @brief Return a sub-slice of this device memory region.
     *
     * Creates a new CudaSlice that represents the byte range from `start` (inclusive)
     * to `end` (exclusive) relative to this slice's base pointer. Values are clamped
     * to this slice's bounds; if `end` is less than `start` an empty slice is
     * returned.
     *
     * @param start Offset in bytes from the start of this slice (inclusive).
     * @param end Offset in bytes from the start of this slice (exclusive).
     * @return CudaSlice The resulting sub-slice covering [start, end).
     */
    CudaSlice slice(size_t start, size_t end)
    {
        if (start > size) start = size;
        if (end > size) end = size;
        if (end < start) end = start;
        return { ptr + start, end - start };
    }

    friend /**
     * @brief Formats a CudaSlice as "[<ptr>+<size>]" into an output stream.
     *
     * Produces a short textual representation containing the slice's device pointer and size.
     *
     * @param os Output stream to write into.
     * @param x CudaSlice to format.
     * @return std::ostream& The same output stream after writing the representation.
     */
    std::ostream&
    operator<<(std::ostream& os, CudaSlice& x)
    {
        return os << "[" << ((void*)x.ptr) << "+" << ((void*)x.size) << "]";
    }
};

/**
 * CudaMemory N-API ObjectWrap
 * Manages a chunk of CUDA device memory.
 */
struct CudaMemory : public Napi::ObjectWrap<CudaMemory>
{
    static Napi::FunctionReference constructor;
    CudaSlice mem;

    static Napi::Function Init(Napi::Env env);
    CudaMemory(const Napi::CallbackInfo& info);
    ~CudaMemory();
    Napi::Value free(const Napi::CallbackInfo& info);
    Napi::Value fill(const Napi::CallbackInfo& info);
    Napi::Value as_buffer(const Napi::CallbackInfo& info);
    Napi::Value copy_to_host_new(const Napi::CallbackInfo& info);
    Napi::Value copy_to_host(const Napi::CallbackInfo& info);
    Napi::Value copy_from_host(const Napi::CallbackInfo& info);
};

Napi::FunctionReference CudaMemory::constructor;

/**
 * @brief Define and export the JavaScript CudaMemory class on the given N-API environment.
 *
 * Creates the N-API class "CudaMemory" with instance methods for freeing, filling,
 * obtaining a Buffer view, and copying to/from host memory, stores a persistent
 * reference to its constructor, and returns the constructor function.
 *
 * @param env N-API environment used to define the class.
 * @return Napi::Function The JavaScript constructor function for the `CudaMemory` class.
 */
Napi::Function
CudaMemory::Init(Napi::Env env)
{
    constructor = Napi::Persistent(DefineClass(env,
        "CudaMemory",
        {
            InstanceMethod<&CudaMemory::free>("free"),
            InstanceMethod<&CudaMemory::fill>("fill"),
            InstanceMethod<&CudaMemory::as_buffer>("as_buffer"),
            InstanceMethod<&CudaMemory::copy_to_host_new>("copy_to_host_new"),
            InstanceMethod<&CudaMemory::copy_to_host>("copy_to_host"),
            InstanceMethod<&CudaMemory::copy_from_host>("copy_from_host"),
        }));
    constructor.SuppressDestruct();
    return constructor.Value();
}

/**
 * @brief Construct a CudaMemory object and allocate a CUDA device memory region.
 *
 * Allocates a device memory region of the size specified by the first argument
 * and stores it in the object's internal slice. Ensures the CUDA context is
 * initialized before allocation.
 *
 * @param info N-API callback info where the first argument is the allocation
 *             size in bytes (Number or BigInt-compatible).
 * @throws Napi::Error If CUDA context initialization or device memory allocation fails.
 */
CudaMemory::CudaMemory(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<CudaMemory>(info)
{
    auto env = info.Env();
    size_t size = info[0].As<Napi::Number>().Int64Value();
    CUdeviceptr ptr = 0;
    cuda_napi_ctx_init(env);
    CU_TRY(cuMemAlloc(&ptr, size));
    mem = { ptr, size };
    DBG1("CudaMemory::ctor " << DVAL(mem));
}

/**
 * @brief Releases the CUDA device memory held by this object and resets its slice to empty.
 *
 * If a device pointer is present, the destructor frees that device memory and sets `mem` to `{0, 0}`.
 */
CudaMemory::~CudaMemory()
{
    if (mem.ptr) {
        auto free_mem = mem;
        mem = { 0, 0 };
        CU_WARN(cuMemFree(free_mem.ptr));
        DBG1("CudaMemory::dtor " << DVAL(free_mem));
    }
}

/**
 * @brief Releases the underlying CUDA device memory held by this instance and clears the stored pointer and size.
 *
 * If no device memory is allocated, the call does nothing.
 *
 * @return Napi::Value JavaScript `undefined`.
 */
Napi::Value
CudaMemory::free(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    if (mem.ptr) {
        auto free_mem = mem;
        mem = { 0, 0 };
        CU_TRY(cuMemFree(free_mem.ptr));
        DBG1("CudaMemory::free " << DVAL(free_mem));
    }
    return env.Undefined();
}

/**
 * @brief Fill a sub-range of the CUDA device memory with a byte value.
 *
 * Expects JS arguments: a numeric value whose low byte is used to fill, and
 * optional start and end offsets (in bytes) that specify the sub-range to fill.
 *
 * @param info Callback arguments where:
 *   - info[0]: fill value (number) — low 8 bits used as the byte pattern.
 *   - info[1] (optional): start offset in bytes (defaults to 0).
 *   - info[2] (optional): end offset in bytes (defaults to the allocation size).
 * @return size_t Number of bytes filled in the device memory slice.
 */
Napi::Value
CudaMemory::fill(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    uint32_t value = info[0].As<Napi::Number>().Uint32Value();
    size_t start = info.Length() > 1 ? info[1].As<Napi::Number>().Int64Value() : 0;
    size_t end = info.Length() > 2 ? info[2].As<Napi::Number>().Int64Value() : mem.size;
    auto slice = mem.slice(start, end);
    uint8_t byte = value & 0xff;
    CU_TRY(cuMemsetD8(slice.ptr, byte, slice.size));
    DBG1("CudaMemory::fill " << DVAL(mem) << DVAL(slice) << DVAL(byte));
    return Napi::Number::New(info.Env(), slice.size);
}

/**
 * @brief Create a Node.js Buffer that views a sub-range of the CUDA device memory managed by this object.
 *
 * The returned Buffer wraps the device pointer for the requested slice and does not copy memory to host.
 * Because its underlying storage is device memory, the Buffer cannot be directly used for JavaScript-level
 * reads/writes; it is intended for passing to native addons or APIs that understand CUDA device pointers.
 *
 * @param info Callback arguments where:
 *   - info[0] (optional) start index, in bytes, within the allocation (default: 0).
 *   - info[1] (optional) end index, in bytes, within the allocation (default: allocation size).
 * @return Napi::Value A Node.js Buffer whose data pointer references the specified device memory slice.
 */
Napi::Value
CudaMemory::as_buffer(const Napi::CallbackInfo& info)
{
    size_t start = info.Length() > 0 ? info[0].As<Napi::Number>().Int64Value() : 0;
    size_t end = info.Length() > 1 ? info[1].As<Napi::Number>().Int64Value() : mem.size;
    auto slice = mem.slice(start, end);
    auto buffer = Napi::Buffer<uint8_t>::New(info.Env(), (uint8_t*)slice.ptr, slice.size);
    DBG1("CudaMemory::as_buffer " << DVAL(mem) << DVAL(slice) << DBUF(buffer));
    return buffer;
}

/**
 * @brief Copies a sub-range of the device memory into a newly allocated Node.js Buffer.
 *
 * Copies device bytes from the range [start, end) of this CudaMemory into a new Buffer and returns that Buffer.
 *
 * @param info[0] Optional start index (byte offset) within the device memory; defaults to 0.
 * @param info[1] Optional end index (byte offset, exclusive) within the device memory; defaults to the allocation size.
 * @return Napi::Buffer<uint8_t> A Buffer containing the copied bytes from the requested sub-range.
 */
Napi::Value
CudaMemory::copy_to_host_new(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    size_t start = info.Length() > 0 ? info[0].As<Napi::Number>().Int64Value() : 0;
    size_t end = info.Length() > 1 ? info[1].As<Napi::Number>().Int64Value() : mem.size;
    auto slice = mem.slice(start, end);
    auto buffer = Napi::Buffer<uint8_t>::New(info.Env(), slice.size);
    CU_TRY(cuMemcpyDtoH(buffer.Data(), slice.ptr, slice.size));
    DBG1("CudaMemory::copy_to_host_new " << DVAL(mem) << DVAL(slice) << DVAL(buffer.Data()));
    return buffer;
}

/**
 * @brief Copy a sub-range of the device memory into a provided host Buffer.
 *
 * Expects a Node.js Buffer as the first argument and optional numeric
 * start and end indices as the second and third arguments. The copy range
 * is the slice [start, end) clamped to the allocation; the number of bytes
 * copied is the lesser of the slice size and the provided buffer's length.
 *
 * @param info CallbackInfo whose arguments are:
 *   - info[0]: Napi::Buffer<uint8_t> destination buffer (required).
 *   - info[1]: start index within the device memory slice (optional, default 0).
 *   - info[2]: end index within the device memory slice (optional, default mem.size).
 * @return Napi::Number Number of bytes actually copied into the provided buffer.
 */
Napi::Value
CudaMemory::copy_to_host(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    auto buffer = info[0].As<Napi::Buffer<uint8_t>>();
    size_t start = info.Length() > 1 ? info[1].As<Napi::Number>().Int64Value() : 0;
    size_t end = info.Length() > 2 ? info[2].As<Napi::Number>().Int64Value() : mem.size;
    auto slice = mem.slice(start, end);
    size_t len = std::min(slice.size, buffer.Length());
    CU_TRY(cuMemcpyDtoH(buffer.Data(), slice.ptr, len));
    DBG1("CudaMemory::copy_to_host " << DVAL(mem) << DVAL(slice) << DBUF(buffer) << DVAL(len));
    return Napi::Number::New(info.Env(), len);
}

/**
 * @brief Copies data from a host buffer into a sub-range of the device memory.
 *
 * Copies up to the lesser of the target slice size and the host buffer length.
 *
 * @param buffer Host Buffer whose contents will be copied into device memory.
 * @param start Optional start index within the device memory slice (default 0).
 * @param end Optional end index within the device memory slice (exclusive, default = mem.size).
 * @return size_t Number of bytes actually copied.
 */
Napi::Value
CudaMemory::copy_from_host(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    auto buffer = info[0].As<Napi::Buffer<uint8_t>>();
    size_t start = info.Length() > 1 ? info[1].As<Napi::Number>().Int64Value() : 0;
    size_t end = info.Length() > 2 ? info[2].As<Napi::Number>().Int64Value() : mem.size;
    auto slice = mem.slice(start, end);
    size_t len = std::min(slice.size, buffer.Length());
    CU_TRY(cuMemcpyHtoD(slice.ptr, buffer.Data(), len));
    DBG1("CudaMemory::copy_from_host " << DVAL(mem) << DVAL(slice) << DBUF(buffer) << DVAL(len));
    return Napi::Number::New(info.Env(), len);
}

/**
 * @brief Allocate CUDA device memory and return a Buffer that wraps it.
 *
 * Allocates a device memory region using the CUDA Runtime API, initializes it,
 * and returns a Node.js Buffer whose lifecycle finalizer frees the device memory.
 *
 * @returns Napi::Value A Buffer pointing to the allocated CUDA device memory; when
 *          the Buffer is garbage-collected or its finalizer runs, `cudaFree` is
 *          invoked to release the device memory.
 *
 * @throws Napi::Error If the build does not enable the CUDA Runtime API (USE_CUDART).
 */
Napi::Value
cuda_malloc(const Napi::CallbackInfo& info)
{
#if USE_CUDART
    size_t size = info[0].As<Napi::Number>().Int64Value();
    // CUDA_TRY(cudaMemcpy(host_ptr, cuda_ptr, size, cudaMemcpyDeviceToHost));
    // CUDA_TRY(cudaMemcpy(cuda_ptr, host_ptr, size, cudaMemcpyHostToDevice));
    size_t size = info[0].As<Napi::Number>().Int64Value();
    void* cuda_ptr = 0;
    CUDA_TRY(cudaMalloc(&cuda_ptr, size));
    CUDA_TRY(cudaMemset(cuda_ptr, 'A', size));
    CUDA_TRY(cudaStreamSynchronize(0));
    cuObjMemoryType_t mem_type = cuObjClient::getMemoryType(cuda_ptr);
    LOG("cuda_malloc: " << DVAL(cuda_ptr) << DVAL(size) << DVAL(mem_type));

    auto finalizer = [](Napi::Env, uint8_t* ptr) { cudaFree(ptr); };
    auto buf = Napi::Buffer<uint8_t>::New(info.Env(), (uint8_t*)cuda_ptr, size, finalizer);
    return buf;
#else
    throw Napi::Error::New(info.Env(),
        "CUDA Runtime API is not enabled in this build (USE_CUDART)");
#endif
}

/**
 * @brief Registers the CudaMemory class on the provided module exports object.
 *
 * Attaches the CudaMemory constructor to `exports` under the property "CudaMemory"
 * and logs that the CUDA library has loaded.
 *
 * @param env N-API environment used to create the class binding.
 * @param exports Module exports object that will receive the `CudaMemory` binding.
 */
void
cuda_napi(Napi::Env env, Napi::Object exports)
{
    exports["CudaMemory"] = CudaMemory::Init(env);
    DBG0("CUDA: library loaded.");
}

} // namespace noobaa