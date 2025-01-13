// Build: gcc -o cudaguy cudaguy.c -I/usr/local/cuda/include/ -L/usr/local/cuda/lib64 -lcuda
// Run: ./cudaguy

#include <cuda.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

#define CU_TRY(fn)                                                 \
    do {                                                           \
        CUresult r = fn;                                           \
        if (r != CUDA_SUCCESS) {                                   \
            const char* cuda_err = "";                             \
            cuGetErrorName(r, &cuda_err);                          \
            fprintf(stderr, "CUDA error: %s %s\n", cuda_err, #fn); \
            exit(1);                                               \
        }                                                          \
    } while (0)

int
main()
{
    size_t size = 8 * 1024 * 1024;
    CUdevice cuda_device = 0;
    CUcontext cuda_ctx = 0;
    CUdeviceptr cuda_ptr = 0;
    CUmemorytype mem_type = CU_MEMORYTYPE_HOST;
    char* host_ptr = (char*)malloc(size);

    CU_TRY(cuInit(0));
    CU_TRY(cuDeviceGet(&cuda_device, 0););
    CU_TRY(cuCtxCreate(&cuda_ctx, 0, cuda_device));
    fprintf(stderr, "CUDA initialized: device %d context %p\n", cuda_device, (void*)cuda_ctx);

    CU_TRY(cuMemAlloc(&cuda_ptr, size));
    CU_TRY(cuMemsetD8(cuda_ptr, 'A', size));
    CU_TRY(cuCtxSynchronize());
    fprintf(stderr, "CUDA allocated %p size %zu\n", (void*)cuda_ptr, size);

    CU_TRY(cuPointerGetAttribute(&mem_type, CU_POINTER_ATTRIBUTE_MEMORY_TYPE, cuda_ptr));
    fprintf(stderr, "CUDA buffer mem type: %d\n", mem_type);

    memset(host_ptr, 'B', size);
    CU_TRY(cuMemcpyDtoH(host_ptr, cuda_ptr, size));

    // skip repeating 'A' at the end, while keeping the first 10 chars,
    // and terminate the string for printing
    int i = size - 1;
    while (i > 10 && host_ptr[i] == 'A') --i;
    host_ptr[i] = '\0';
    fprintf(stderr, "CUDA copied to host: %s\n", host_ptr);

    free(host_ptr);
    CU_TRY(cuMemFree(cuda_ptr));
    CU_TRY(cuCtxDestroy(cuda_ctx));
    fprintf(stderr, "CUDA freed\n");

    return 0;
}