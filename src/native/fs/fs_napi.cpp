/* Copyright (C) 2016 NooBaa */
#include "../util/b64.h"
#include "../util/buf.h"
#include "../util/common.h"
#include "../util/napi.h"
#include "../util/os.h"

// Disable pedantic warning temporarily to include GPFS headers which have zero-length arrays
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wpedantic"
#include "./gpfs.h"
#include "./gpfs_fcntl.h"
#include "./gpfs_rdma_experimental.h"
#pragma GCC diagnostic pop

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <map>
#include <math.h>
#include <pwd.h>
#include <stdlib.h>
#include <sys/fcntl.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/uio.h>
#include <sys/xattr.h>
#include <thread>
#include <typeinfo>
#include <unistd.h>
#include <uv.h>
#include <vector>

#ifdef __APPLE__
    #include <sys/mount.h>
    #include <sys/param.h>
#else
    #include <sys/statfs.h>
#endif

#ifndef __APPLE__
    #define ENOATTR ENODATA
#endif

#define ROUNDUP(X, Y) ((Y) * (((X) + (Y) - 1) / (Y)))

// Should total to 256 (sizeof(buffer) 216 + sizeof(header) 16 + sizeof(payload) 24)
#define GPFS_XATTR_BUFFER_SIZE 216
#define GPFS_BACKEND "GPFS"
#define GPFS_XATTR_PREFIX "gpfs"
#define GPFS_DOT_ENCRYPTION_EA "Encryption"
#define GPFS_ENCRYPTION_XATTR_NAME GPFS_XATTR_PREFIX "." GPFS_DOT_ENCRYPTION_EA
#define GPFS_DMAPI_XATTR_PREFIX "dmapi"
#define GPFS_DMAPI_DOT_IBMOBJ_EA "IBMObj"
#define GPFS_DMAPI_DOT_IBMPMIG_EA "IBMPMig"
#define GPFS_DMAPI_DOT_IBMTPS_EA "IBMTPS"
#define GPFS_DMAPI_XATTR_TAPE_INDICATOR GPFS_DMAPI_XATTR_PREFIX "." GPFS_DMAPI_DOT_IBMOBJ_EA
#define GPFS_DMAPI_XATTR_TAPE_PREMIG GPFS_DMAPI_XATTR_PREFIX "." GPFS_DMAPI_DOT_IBMPMIG_EA
#define GPFS_DMAPI_XATTR_TAPE_TPS GPFS_DMAPI_XATTR_PREFIX "." GPFS_DMAPI_DOT_IBMTPS_EA

// This macro should be used after openning a file
// it will autoclose the file using AutoCloser and will throw an error in case of failures
#define CHECK_OPEN_FD(fd)        \
    AutoCloser closer(this, fd); \
    do {                         \
        if (fd < 0) {            \
            SetSyscallError();   \
            return;              \
        }                        \
    } while (0)

// This macro should be used when we want to verify a file is open inside a wrapper function
// it won't autoclose and will throw an error in case of the fd is not open
#define CHECK_WRAP_FD(fd)                                                       \
    do {                                                                        \
        if (fd < 0) {                                                           \
            SetError(XSTR() << _desc << ": ERROR not opened " << _wrap->_path); \
            return;                                                             \
        }                                                                       \
    } while (0)

// This macro should be used after calling any syscall/gpfs-syscall that uses errno
// in case of failures - it will throw the errno using SetSyscallError
#define SYSCALL_OR_RETURN(x)   \
    do {                       \
        int r = (x);           \
        if (r) {               \
            SetSyscallError(); \
            return;            \
        }                      \
    } while (0)

// This macro should be used after calling any syscall/gpfs-syscall that uses errno
// in case of failures - it will warn and continue
#define SYSCALL_OR_WARN(x)                                                                \
    do {                                                                                  \
        int r = (x);                                                                      \
        if (r) {                                                                          \
            int current_errno = errno;                                                    \
            std::string errmsg = strerror(current_errno);                                 \
            LOG("FS::FSWorker:: WARN " << _desc << DVAL(current_errno) << " " << errmsg); \
        }                                                                                 \
    } while (0)

// This macro should be used after calling any gpfs-fcntl which doesn't use errno
// It will handle error which number will be saved under gpfs_error
#define GPFS_FCNTL_OR_RETURN(x)                                              \
    do {                                                                     \
        int gpfs_error = 0;                                                  \
        int r = (x);                                                         \
        if (r) {                                                             \
            if (gpfs_error) {                                                \
                SetError(XSTR() << "GPFS FCNTL error:" << DVAL(gpfs_error)); \
            } else {                                                         \
                SetSyscallError();                                           \
            }                                                                \
            return;                                                          \
        }                                                                    \
    } while (0)

// This macro should be used when calling fstat in case we want to validate
// no race condition happened changing the fd during the function run
#define CHECK_CTIME_CHANGE(fd, stat_res, path)                    \
    do {                                                          \
        auto start_ctime = stat_res.st_ctime;                     \
        SYSCALL_OR_RETURN(fstat(fd, &stat_res));                  \
        auto end_ctime = stat_res.st_ctime;                       \
        if (start_ctime != end_ctime) {                           \
            SetError(XSTR() << "FileStat: " << DVAL(path)         \
                            << " cancelled due to ctime change"); \
        }                                                         \
    } while (0)

// This macro is similar to `CHECK_CTIME_CHANGE` but it is used when we want to
// instead use mtime instead of ctime. Using mtime instead of ctime is useful
// when the inode data may change but should not interfere with the operations
// NooBaa is doing.
#define CHECK_MTIME_CHANGE(fd, stat_res, path)                    \
    do {                                                          \
        auto start_mtime = stat_res.st_mtime;                     \
        SYSCALL_OR_RETURN(fstat(fd, &stat_res));                  \
        auto end_mtime = stat_res.st_mtime;                       \
        if (start_mtime != end_mtime) {                           \
            SetError(XSTR() << "FileStat: " << DVAL(path)         \
                            << " cancelled due to mtime change"); \
        }                                                         \
    } while (0)

#ifdef __APPLE__
    #define flistxattr(a, b, c) ::flistxattr(a, b, c, 0)
    #define getxattr(a, b, c, d) ::getxattr(a, b, c, d, 0, 0)
    #define fgetxattr(a, b, c, d) ::fgetxattr(a, b, c, d, 0, 0)
    #define fsetxattr(a, b, c, d, e) ::fsetxattr(a, b, c, d, e, 0)
    #define fremovexattr(a, b) ::fremovexattr(a, b, 0)
#endif

#ifdef __APPLE__
typedef unsigned long long DirOffset;
    #define DIR_OFFSET_FIELD d_seekoff
#else
typedef long DirOffset;
    #define DIR_OFFSET_FIELD d_off
#endif

namespace noobaa
{

DBG_INIT(0);

typedef std::map<std::string, std::string> XattrMap;

const char* gpfs_dl_path = std::getenv("GPFS_DL_PATH");

int gpfs_lib_file_exists = -1;

static decltype(&gpfs_fcntl) dlsym_gpfs_fcntl = 0;
static decltype(&gpfs_linkat) dlsym_gpfs_linkat = 0;
static decltype(&gpfs_linkatif) dlsym_gpfs_linkatif = 0;
static decltype(&gpfs_unlinkat) dlsym_gpfs_unlinkat = 0;
static decltype(&gpfs_rdma_pread) dlsym_gpfs_rdma_pread = 0;
static decltype(&gpfs_rdma_pwrite) dlsym_gpfs_rdma_pwrite = 0;
static decltype(&gpfs_rdma_shadow_buffer_size) dlsym_gpfs_rdma_shadow_buffer_size = 0;

// gpfs_ganesha is defined in gpfs_nfs.h which we do not include directly
// but we use it to register noobaa specific options
static int (*dlsym_gpfs_ganesha)(int op, void* oarg) = 0;
struct gpfs_ganesha_noobaa_arg
{
    int noobaa_version;
    int noobaa_delay;
    int noobaa_flags;
};
#define OPENHANDLE_REGISTER_NOOBAA 157

/**
 * @brief Create a Napi::Error populated from a system errno and optional message.
 *
 * Constructs a JavaScript Error whose message includes the system error description
 * and whose `code` property is set to the libuv/errno error name.
 *
 * @param env The N-API environment used to create the Error.
 * @param msg Optional contextual message to prefix the system error description.
 *            If empty, the Error message will be the system error description alone.
 * @param errno_val System error value to use; defaults to the current `errno`.
 * @return Napi::Error Error object with `message` containing the description and
 *         `code` set to the libuv error name corresponding to `errno_val`.
 */
static Napi::Error
napi_sys_error(Napi::Env env, std::string msg = "", int errno_val = errno)
{
    const char* err_code = uv_err_name(uv_translate_sys_error(errno_val));
    const char* err_desc = uv_strerror(uv_translate_sys_error(errno_val));
    if (msg.empty()) {
        msg = err_desc;
    } else {
        msg += ": ";
        msg += err_desc;
    }
    auto err = Napi::Error::New(env, msg);
    err.Set("code", Napi::String::New(env, err_code));
    return err;
}

static const int DIO_BUFFER_MEMALIGN = 4096;

/**
 * @brief Releases memory used by an external N-API buffer.
 *
 * This function is intended to be used as the finalize/release callback for
 * Napi::Buffer that wraps externally allocated memory.
 *
 * @param buf Pointer to the buffer memory to free; if null, no action is taken.
 */
static void
buffer_releaser(Napi::Env env, uint8_t* buf)
{
    if (buf) free(buf);
}

static int
parse_open_flags(std::string flags)
{
    int bits = 0;
    for (char ch : flags) {
        switch (ch) {
        case 'r':
            bits |= O_RDONLY;
            break;
        case 'w':
            bits |= O_TRUNC | O_CREAT | O_WRONLY;
            break;
        case 'a':
            bits |= O_APPEND | O_CREAT | O_WRONLY;
            break;
        case '+':
            bits |= O_RDWR;
            bits &= ~(O_RDONLY | O_WRONLY);
            break;
        case '*':
            bits &= ~(O_TRUNC);
            break;
        case 's':
            bits |= O_SYNC;
            break;
        case 'x':
            bits |= O_EXCL;
            break;
        case 't':
#ifdef O_TMPFILE
            bits |= O_TMPFILE | O_RDWR;
            bits &= ~(O_RDONLY | O_WRONLY | O_TRUNC | O_CREAT);
#else
            LOG("FS: Unsupported O_TMPFILE " << flags);
#endif
            break;
        case 'd':
#ifdef O_DIRECT
            bits |= O_DIRECT;
#else
            LOG("FS: Unsupported O_DIRECT " << flags);
#endif
            break;
        default:
            LOG("FS: Unexpected open flags " << flags);
            return -1;
        }
    }
    return bits;
}

const static std::vector<std::string> GPFS_XATTRS{ GPFS_ENCRYPTION_XATTR_NAME };
const static std::vector<std::string> GPFS_DMAPI_XATTRS{
    GPFS_DMAPI_XATTR_TAPE_INDICATOR,
    GPFS_DMAPI_XATTR_TAPE_PREMIG,
    GPFS_DMAPI_XATTR_TAPE_TPS,
};
const static std::vector<std::string> USER_XATTRS{
    "user.content_type",
    "user.content_md5",
    "user.noobaa.version_id",
    "user.noobaa.prev_version_id",
    "user.noobaa.delete_marker",
    "user.noobaa.dir_content",
    "user.noobaa.part_offset",
    "user.noobaa.part_size",
    "user.noobaa.part_etag",
    "user.storage_class",
    "user.noobaa.restore.request",
    "user.noobaa.restore.expiry",
};

struct Entry
{
    std::string name;
    ino_t ino;
    uint8_t type;
    DirOffset off;
};

// Disable pedantic warning temporarily to use GPFS struct which have zero-length arrays
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wpedantic"
struct gpfsRequest_t
{
    gpfsFcntlHeader_t header;
    gpfsGetSetXAttr_t payload;
    char buffer[GPFS_XATTR_BUFFER_SIZE];
};
#pragma GCC diagnostic pop

static_assert(sizeof(struct gpfsRequest_t) == 256, "gpfsRequest_t size mismatch");

/**
 * @brief Populate a gpfsRequest_t with a GPFS "get extended attribute" request for the given attribute name.
 *
 * Fills the request header and payload fields (lengths, type, flags, and buffer) and copies the attribute name
 * into the request payload buffer. The request is prepared for a GPFS fcntl GET_XATTR operation.
 *
 * @param reqP Pointer to the gpfsRequest_t structure to populate; must point to writable storage.
 * @param key The extended attribute name to request; its bytes are copied into the request payload buffer.
 */
static void
build_gpfs_get_ea_request(gpfsRequest_t* reqP, std::string key)
{
    int nameLen = key.size();
    int bufLen = sizeof(reqP->buffer);
    memset(reqP->buffer, 0, bufLen);

    reqP->header.totalLength = sizeof(*reqP);
    reqP->header.fcntlVersion = GPFS_FCNTL_CURRENT_VERSION;
    reqP->payload.structLen = reqP->header.totalLength - sizeof(reqP->header);
    reqP->payload.structType = GPFS_FCNTL_GET_XATTR;
    reqP->payload.nameLen = nameLen;
    reqP->payload.bufferLen = bufLen - nameLen;
    reqP->payload.flags = GPFS_FCNTL_XATTRFLAG_NONE;
    memcpy(&reqP->payload.buffer[0], key.c_str(), nameLen);
}

template <typename T>
static Napi::Value
api(const Napi::CallbackInfo& info)
{
    auto w = new T(info);
    Napi::Promise promise = w->_deferred.Promise();
    w->Queue();
    return promise;
}

static void
set_stat_res(Napi::Object res, Napi::Env env, struct stat& stat_res, XattrMap& xattr_res)
{
    res["dev"] = Napi::Number::New(env, stat_res.st_dev);
    res["ino"] = Napi::Number::New(env, stat_res.st_ino);
    res["mode"] = Napi::Number::New(env, stat_res.st_mode);
    res["nlink"] = Napi::Number::New(env, stat_res.st_nlink);
    res["uid"] = Napi::Number::New(env, stat_res.st_uid);
    res["gid"] = Napi::Number::New(env, stat_res.st_gid);
    res["rdev"] = Napi::Number::New(env, stat_res.st_rdev);
    res["size"] = Napi::Number::New(env, stat_res.st_size);
    res["blksize"] = Napi::Number::New(env, stat_res.st_blksize);
    res["blocks"] = Napi::Number::New(env, stat_res.st_blocks);

// https://nodejs.org/dist/latest-v14.x/docs/api/fs.html#fs_stat_time_values
#ifdef __APPLE__
    double atimeMs = (double(1e3) * stat_res.st_atimespec.tv_sec) + (double(1e-6) * stat_res.st_atimespec.tv_nsec);
    double ctimeMs = (double(1e3) * stat_res.st_ctimespec.tv_sec) + (double(1e-6) * stat_res.st_ctimespec.tv_nsec);
    double mtimeMs = (double(1e3) * stat_res.st_mtimespec.tv_sec) + (double(1e-6) * stat_res.st_mtimespec.tv_nsec);
    double birthtimeMs = (double(1e3) * stat_res.st_birthtimespec.tv_sec) + (double(1e-6) * stat_res.st_birthtimespec.tv_nsec);
    double atimeNs = (double(1e9) * stat_res.st_atimespec.tv_sec) + stat_res.st_atimespec.tv_nsec;
    double ctimeNs = (double(1e9) * stat_res.st_ctimespec.tv_sec) + stat_res.st_ctimespec.tv_nsec;
    double mtimeNs = (double(1e9) * stat_res.st_mtimespec.tv_sec) + stat_res.st_mtimespec.tv_nsec;
#else
    double atimeMs = (double(1e3) * stat_res.st_atim.tv_sec) + (double(1e-6) * stat_res.st_atim.tv_nsec);
    double ctimeMs = (double(1e3) * stat_res.st_ctim.tv_sec) + (double(1e-6) * stat_res.st_ctim.tv_nsec);
    double mtimeMs = (double(1e3) * stat_res.st_mtim.tv_sec) + (double(1e-6) * stat_res.st_mtim.tv_nsec);
    double birthtimeMs = ctimeMs; // Posix doesn't have birthtime
    double atimeNs = (double(1e9) * stat_res.st_atim.tv_sec) + stat_res.st_atim.tv_nsec;
    double ctimeNs = (double(1e9) * stat_res.st_ctim.tv_sec) + stat_res.st_ctim.tv_nsec;
    double mtimeNs = (double(1e9) * stat_res.st_mtim.tv_sec) + stat_res.st_mtim.tv_nsec;
#endif

    res["atimeMs"] = Napi::Number::New(env, atimeMs);
    res["ctimeMs"] = Napi::Number::New(env, ctimeMs);
    res["mtimeMs"] = Napi::Number::New(env, mtimeMs);
    res["birthtimeMs"] = Napi::Number::New(env, birthtimeMs);
    res["atime"] = Napi::Date::New(env, uint64_t(round(atimeMs)));
    res["mtime"] = Napi::Date::New(env, uint64_t(round(mtimeMs)));
    res["ctime"] = Napi::Date::New(env, uint64_t(round(ctimeMs)));
    res["birthtime"] = Napi::Date::New(env, uint64_t(round(birthtimeMs)));

    // high resolution times
    res["atimeNsBigint"] = Napi::BigInt::New(env, int64_t(round(atimeNs)));
    res["ctimeNsBigint"] = Napi::BigInt::New(env, int64_t(round(ctimeNs)));
    res["mtimeNsBigint"] = Napi::BigInt::New(env, int64_t(round(mtimeNs)));

    auto xattr = Napi::Object::New(env);
    res["xattr"] = xattr;
    for (auto it = xattr_res.begin(); it != xattr_res.end(); ++it) {
        xattr.Set(it->first, it->second);
    }
}

static void
set_statfs_res(Napi::Object res, Napi::Env env, struct statfs& statfs_res)
{
    res["type"] = Napi::Number::New(env, statfs_res.f_type);
    res["bsize"] = Napi::Number::New(env, statfs_res.f_bsize);
    res["blocks"] = Napi::Number::New(env, statfs_res.f_blocks);
    res["bfree"] = Napi::Number::New(env, statfs_res.f_bfree);
    res["bavail"] = Napi::Number::New(env, statfs_res.f_bavail);
    res["files"] = Napi::Number::New(env, statfs_res.f_files);
    res["ffree"] = Napi::Number::New(env, statfs_res.f_ffree);
    // Linux, SunOS, HP-UX, 4.4BSD have a system call statfs() that returns a struct statfs (defined in <sys/vfs.h>)
    // containing a fsid_t f_fsid, where fsid_t is defined as struct { int val[2]; }.
    // so it's an array of two integers
    // For now commenting out res["fsid"] as we cant use Napi::Number on it
    // TODO: when we will need fsid in the results uncomment it and fix it.
    // res["fsid"] = Napi::Number::New(env, statfs_res.f_fsid);
    res["flags"] = Napi::Number::New(env, statfs_res.f_flags);

#ifndef __APPLE__
    res["namelen"] = Napi::Number::New(env, statfs_res.f_namelen);
    res["frsize"] = Napi::Number::New(env, statfs_res.f_frsize);
#endif
}

static void
set_fs_worker_stats(Napi::Env env, Napi::Object fs_worker_stats, std::string work_name, double took_time, int error)
{
    fs_worker_stats["name"] = Napi::String::New(env, work_name);
    fs_worker_stats["took_time"] = Napi::Number::New(env, took_time);
    fs_worker_stats["error"] = Napi::Number::New(env, error);
}

static void
set_getpwnam_res(Napi::Env env, Napi::Object getpwnam_res, struct passwd& _getpwnam_res)
{
    getpwnam_res["name"] = Napi::String::New(env, _getpwnam_res.pw_name);
    getpwnam_res["uid"] = Napi::Number::New(env, _getpwnam_res.pw_uid);
    getpwnam_res["gid"] = Napi::Number::New(env, _getpwnam_res.pw_gid);
}

static bool
cmp_ver_id(int64_t link_expected_mtime, int64_t link_expected_inode, struct stat& _stat_res)
{
    // extract actual stat ino and mtime
    int64_t stat_actual_ino = _stat_res.st_ino;
#ifdef __APPLE__
    auto actual_mtime_sec = _stat_res.st_mtimespec.tv_sec;
    auto actual_mtime_nsec = _stat_res.st_mtimespec.tv_nsec;
#else
    auto actual_mtime_sec = _stat_res.st_mtim.tv_sec;
    auto actual_mtime_nsec = _stat_res.st_mtim.tv_nsec;
#endif
    auto actual_mtimeNs = int64_t(round((double(1e9) * actual_mtime_sec)) + actual_mtime_nsec);
    return link_expected_mtime == actual_mtimeNs && link_expected_inode == stat_actual_ino;
}

static int
get_single_user_xattr(int fd, std::string key, std::string& value)
{
    ssize_t value_len = fgetxattr(fd, key.c_str(), NULL, 0);
    if (value_len == -1) return -1;
    if (value_len > 0) {
        Buf val(value_len);
        value_len = fgetxattr(fd, key.c_str(), val.cdata(), value_len);
        if (value_len == -1) return -1;
        value = std::string(val.cdata(), value_len);
    } else if (value_len == 0) {
        value = "";
    }
    return 0;
}

static int
get_fd_xattr(int fd, XattrMap& xattr, const std::vector<std::string>& xattr_keys)
{
    if (xattr_keys.size() > 0) { // we won't list the attributes just return the prefefined list
        for (auto const& key : xattr_keys) {
            std::string value;
            int r = get_single_user_xattr(fd, key, value);
            if (r) {
                if (errno == ENOATTR) continue;
                return r;
            }
            xattr[key] = value;
        }
    } else {
        ssize_t buf_len = flistxattr(fd, NULL, 0);
        if (buf_len <= 0) return buf_len;
        Buf buf(buf_len);
        buf_len = flistxattr(fd, buf.cdata(), buf_len);
        // No xattr, nothing to do
        if (buf_len <= 0) return buf_len;
        while (buf.length()) {
            std::string key(buf.cdata());
            std::string value;
            int r = get_single_user_xattr(fd, key, value);
            if (r) return r;
            xattr[key] = value;
            buf.slice(key.size() + 1, buf.length());
        }
    }
    return 0;
}

/**
 * @brief Retrieve GPFS-specific extended attributes for an open file descriptor.
 *
 * Queries the GPFS fcntl interface for each attribute name in the GPFS xattr list
 * (and additionally DMAPI xattrs when `use_dmapi` is true) and inserts any found
 * attribute values into `xattr`. Updates `gpfs_error` with the GPFS fcntl error
 * reason code returned by the last attribute request.
 *
 * @param fd File descriptor of the target file.
 * @param xattr Map to populate with found attribute key -> value pairs.
 * @param gpfs_error Receives the GPFS fcntl error reason code from the last request.
 * @param use_dmapi When true, include DMAPI attribute names in the queries.
 * @return int `0` on success; if the underlying dlsym_gpfs_fcntl call fails returns its error code
 *             (errno is set); if GPFS reports an error for an attribute (other than "no attribute")
 *             returns that GPFS error code.
 */
static int
get_fd_gpfs_xattr(int fd, XattrMap& xattr, int& gpfs_error, bool use_dmapi)
{
    auto gpfs_xattrs{ GPFS_XATTRS };
    if (use_dmapi) {
        gpfs_xattrs.insert(gpfs_xattrs.end(), GPFS_DMAPI_XATTRS.begin(), GPFS_DMAPI_XATTRS.end());
    }

    for (auto const& key : gpfs_xattrs) {
        gpfsRequest_t gpfsGetXattrRequest;
        build_gpfs_get_ea_request(&gpfsGetXattrRequest, key);
        int r = dlsym_gpfs_fcntl(fd, &gpfsGetXattrRequest);
        if (r) return r; // errno is set
        gpfs_error = gpfsGetXattrRequest.payload.errReasonCode;
        if (gpfs_error == GPFS_FCNTL_ERR_NONE) {
            int name_len = gpfsGetXattrRequest.payload.nameLen;
            int buffer_len = gpfsGetXattrRequest.payload.bufferLen;
            xattr[key] = std::string((char*)gpfsGetXattrRequest.buffer + name_len, buffer_len);
        } else if (gpfs_error != GPFS_FCNTL_ERR_NO_ATTR) {
            LOG("get_fd_gpfs_xattr: get GPFS xattr with fcntl failed with error." << DVAL(gpfs_error));
            return gpfs_error;
        }
    }
    return 0;
}

static void
get_xattr_from_object(XattrMap& xattr, Napi::Object obj)
{
    auto keys = obj.GetPropertyNames();
    for (uint32_t i = 0; i < keys.Length(); ++i) {
        auto key = keys.Get(i).ToString().Utf8Value();
        auto value = obj.Get(key).ToString().Utf8Value();
        xattr[key] = value;
    }
}

/**
 * TODO: Not atomic and might cause partial updates of MD
 * need to be tested
 */
static int
clear_xattr(int fd, std::string _prefix)
{
    ssize_t buf_len = flistxattr(fd, NULL, 0);
    // No xattr, nothing to do
    if (buf_len == 0) return 0;
    if (buf_len == -1) return -1;
    Buf buf(buf_len);
    buf_len = flistxattr(fd, buf.cdata(), buf_len);
    // No xattr, nothing to do
    if (buf_len == 0) return 0;
    if (buf_len == -1) return -1;
    while (buf.length()) {
        std::string key(buf.cdata());
        // remove xattr only if its key starts with prefix
        if (key.rfind(_prefix, 0) == 0) {
            ssize_t value_len = fremovexattr(fd, key.c_str());
            if (value_len == -1) return -1;
        }
        buf.slice(key.size() + 1, buf.length());
    }
    return 0;
}

/**
 * @brief Load xattr keys from a JavaScript options object into a C++ vector.
 *
 * If the `options` object contains a truthy `xattr_get_keys` property, replaces
 * `_xattr_get_keys` with the string elements of that array. Otherwise, if
 * `options` has a truthy `skip_user_xattr` property, sets `_xattr_get_keys`
 * to the predefined `USER_XATTRS`.
 *
 * @param options JavaScript options object that may contain `xattr_get_keys` (Array)
 *                or `skip_user_xattr` (boolean).
 * @param _xattr_get_keys Output vector that will be replaced with the selected keys.
 */
static void
load_xattr_get_keys(Napi::Object& options, std::vector<std::string>& _xattr_get_keys)
{
    if (options.Get("xattr_get_keys").ToBoolean()) {
        Napi::Array keys = options.Get("xattr_get_keys").As<Napi::Array>();
        auto keys_length = keys.Length();

        _xattr_get_keys.clear();
        _xattr_get_keys.reserve(keys_length);
        for (uint32_t i = 0; i < keys_length; i++) {
            _xattr_get_keys.push_back(keys.Get(i).As<Napi::String>());
        }
    } else if (options.Get("skip_user_xattr").ToBoolean()) {
        _xattr_get_keys = USER_XATTRS;
    }
}

/**
 * converts Napi::Array of numbers to std::vector
 * typename T - type of the vector to convert to (e.g int, uint, gid_t)
 * warning: function will only work on vector with numeric types. should not be used with other types
 */
template <typename T>
/**
 * @brief Convert a JavaScript numeric array to a C++ vector of numbers.
 *
 * Converts each element of the provided Napi::Array to a numeric value using
 * N-API's ToNumber and returns a std::vector containing those values converted
 * to type `T`.
 *
 * @tparam T Numeric type of the resulting vector elements (e.g., int, double).
 * @param arr JavaScript array whose elements are expected to be numbers.
 * @return std::vector<T> Vector of values from `arr` converted to `T`.
 */
static std::vector<T>
convert_napi_number_array_to_number_vector(const Napi::Array& arr)
{
    std::vector<T> new_vector;
    const std::size_t arr_length = arr.Length();
    for (std::size_t i = 0; i < arr_length; ++i) {
        new_vector.push_back(static_cast<Napi::Value>(arr[i]).ToNumber());
    }
    return new_vector;
}

/**
 * converts std::vector to comma seperated string so it can be printed to logs
 */
template <typename T>
/**
 * @brief Converts a vector of values into a comma-separated string.
 *
 * Produces a single string containing each element of the input vector in order,
 * separated by commas with no surrounding spaces.
 *
 * @tparam T Type of the vector elements; must be stream-insertable (operator<<).
 * @param vec Vector of elements to stringify.
 * @return std::string Comma-separated representation of the vector elements (empty string for an empty vector).
 */
static std::string
stringfy_vector(std::vector<T>& vec)
{
    std::stringstream ss;
    std::size_t size = vec.size();
    for (std::size_t i = 0; i < size; ++i) {
        if (i > 0) ss << ',';
        ss << vec[i];
    }
    return ss.str();
}

/**
 * @brief Formats the current process's supplemental group IDs into a comma-separated string.
 *
 * @return std::string Comma-separated list of group IDs (gid_t). Returns an empty string if the process has no supplemental groups.
 */
static std::string
get_groups_as_string()
{
    std::vector<gid_t> groups = ThreadScope::get_process_groups();
    return stringfy_vector(groups);
}

/**
 * FSWorker is a general async worker for our fs operations
 */
struct FSWorker : public Napi::AsyncWorker
{
    Napi::Promise::Deferred _deferred;
    // _args_ref is used to keep refs to all the args for the worker lifetime,
    // which is needed for workers that receive buffers,
    // because in their ctor they copy the pointers to the buffer's memory,
    // and if the JS caller scope does not keep a ref to the buffers until after the call,
    // then the worker may access invalid memory...
    Napi::ObjectReference _args_ref;
    pid_t _tid;
    uid_t _uid;
    gid_t _gid;
    std::string _backend;
    std::string _desc;
    std::string _work_name;
    int _errno;
    int _warn_threshold_ms;
    double _took_time;
    Napi::FunctionReference _report_fs_stats;
    bool _should_add_thread_capabilities;
    std::vector<gid_t> _supplemental_groups;

    // executes the ctime check in the stat and read file fuctions
    // NOTE: If _do_ctime_check = false, then some functions will fallback to using mtime check
    bool _do_ctime_check;

    bool _use_dmapi;

    FSWorker(const Napi::CallbackInfo& info)
        : AsyncWorker(info.Env())
        , _deferred(Napi::Promise::Deferred::New(info.Env()))
        , _args_ref(Napi::Persistent(Napi::Object::New(info.Env())))
        , _tid(0)
        , _uid(ThreadScope::orig_uid)
        , _gid(ThreadScope::orig_gid)
        , _errno(0)
        , _warn_threshold_ms(0)
        , _took_time(0)
        , _should_add_thread_capabilities(false)
        , _supplemental_groups()
        , _do_ctime_check(false)
        , _use_dmapi(false)
    {
        for (int i = 0; i < (int)info.Length(); ++i) _args_ref.Set(i, info[i]);
        if (info[0].ToBoolean()) {
            Napi::Object fs_context = info[0].As<Napi::Object>();
            if (fs_context.Get("uid").IsNumber()) _uid = fs_context.Get("uid").ToNumber();
            if (fs_context.Get("gid").IsNumber()) _gid = fs_context.Get("gid").ToNumber();
            if (fs_context.Get("backend").ToBoolean()) {
                _backend = fs_context.Get("backend").ToString();
            }
            if (fs_context.Has("supplemental_groups")) {
                _supplemental_groups = convert_napi_number_array_to_number_vector<gid_t>(fs_context.Get("supplemental_groups").As<Napi::Array>());
            }
            if (fs_context.Get("warn_threshold_ms").ToBoolean()) {
                _warn_threshold_ms = fs_context.Get("warn_threshold_ms").ToNumber();
            }
            if (fs_context.Get("report_fs_stats").ToBoolean()) {
                _report_fs_stats = Napi::Persistent(fs_context.Get("report_fs_stats").As<Napi::Function>());
            }
            _do_ctime_check = fs_context.Get("do_ctime_check").ToBoolean();
            _use_dmapi = fs_context.Get("use_dmapi").ToBoolean();
        }
    }
    void Begin(std::string desc)
    {
        _desc = desc;
        _work_name = _desc.substr(0, _desc.find(" "));
        DBG1("FS::FSWorker::Begin: " << _desc);
    }
    virtual void Work() = 0;
    /**
     * @brief Prepare thread credentials, run the worker's task, and record execution time.
     *
     * Prepares a ThreadScope using the worker's UID, GID, and supplemental groups (and optionally adds thread capabilities),
     * invokes the virtual Work() implementation, measures the elapsed wall-clock time in milliseconds and stores it in
     * _took_time, and emits a warning log if the duration exceeds _warn_threshold_ms.
     *
     * Side effects:
     * - Changes the thread's effective UID/GID and supplemental groups for the duration of the call.
     * - May enable additional thread capabilities when _should_add_thread_capabilities is true.
     * - Calls the virtual Work() method, which performs the actual operation and may modify member state and set errors.
     */
    void Execute() override
    {
        const std::string supplemental_groups = stringfy_vector(_supplemental_groups);
        DBG1("FS::FSWorker::Execute: " << _desc << DVAL(_uid) << DVAL(_gid) << DVAL(_backend) << DVAL(supplemental_groups));
        ThreadScope tx;
        tx.set_user(_uid, _gid, _supplemental_groups);
        std::string new_supplemental_groups = get_groups_as_string();
        DBG1("FS::FSWorker::Execute: " << _desc << DVAL(_uid) << DVAL(_gid) << DVAL(geteuid()) << DVAL(getegid()) << DVAL(getuid()) << DVAL(getgid()) << DVAL(new_supplemental_groups));

        if (_should_add_thread_capabilities) {
            tx.add_thread_capabilities();
        }
        auto start_time = std::chrono::high_resolution_clock::now();
        Work();
        auto end_time = std::chrono::high_resolution_clock::now();
        _took_time = std::chrono::duration<double, std::milli>(end_time - start_time).count();
        if (_warn_threshold_ms && _took_time > _warn_threshold_ms) {
            DBG0("FS::FSWorker::Execute: WARNING " << _desc << " took too long: " << _took_time << " ms");
        } else {
            DBG1("FS::FSWorker::Execute: " << _desc << " took: " << _took_time << " ms");
        }
    }
    void SetSyscallError()
    {
        if (_errno) {
            int current_errno = errno;
            DBG1("FS::FSWorker::SetSyscallError: errno already exists " << _desc << DVAL(_errno) << DVAL(current_errno));
        } else {
            _errno = errno;
            std::string errmsg = strerror(errno);
            SetError(errmsg);
        }
    }
    void ReportWorkerStats(int error)
    {
        if (!_report_fs_stats.IsEmpty()) {
            Napi::Env env = Env();
            auto fs_worker_stats = Napi::Object::New(env);
            set_fs_worker_stats(env, fs_worker_stats, _work_name, _took_time, error);
            _report_fs_stats.Call({ fs_worker_stats });
        }
    }
    /**
     * @brief Determines whether the GPFS dynamic library should be used.
     *
     * Checks that a GPFS library path was provided, that the library existence check
     * has been performed, and that the current backend is configured as GPFS.
     *
     * @return `true` if the GPFS library path is set, the library existence check has completed (value > -1),
     *         and the configured backend equals `GPFS_BACKEND`; `false` otherwise.
     */
    bool use_gpfs_lib()
    {
        return gpfs_dl_path != NULL && gpfs_lib_file_exists > -1 && _backend == GPFS_BACKEND;
    }
    /**
     * @brief Mark the worker to add elevated thread capabilities before execution.
     *
     * When set, the worker will attempt to enable additional thread capabilities
     * (e.g., for privileged operations) during its Execute phase.
     */
    void AddThreadCapabilities()
    {
        _should_add_thread_capabilities = true;
    }
    /**
     * @brief Finalize a successful worker by resolving its promise and reporting stats.
     *
     * Resolves the worker's stored JavaScript promise with `undefined` and invokes
     * ReportWorkerStats to publish success metrics.
     */
    virtual void OnOK() override
    {
        DBG1("FS::FSWorker::OnOK: undefined " << _desc);
        _deferred.Resolve(Env().Undefined());
        ReportWorkerStats(0);
    }
    virtual void OnError(Napi::Error const& error) override
    {
        Napi::Env env = Env();
        DBG1("FS::FSWorker::OnError: " << _desc << " " << DVAL(error.Message()));
        ReportWorkerStats(1);
        auto obj = error.Value();
        if (_errno) {
            obj.Set("code", Napi::String::New(env, uv_err_name(uv_translate_sys_error(_errno))));
        }

        obj.Set("context", Napi::String::New(env, _desc));

        _deferred.Reject(obj);
    }
};

struct AutoCloser
{
    FSWorker* _worker;
    int _fd;
    AutoCloser(FSWorker* worker, int fd)
        : _worker(worker), _fd(fd) {}
    ~AutoCloser()
    {
        if (_fd >= 0) {
            int r = close(_fd);
            if (r) _worker->SetSyscallError();
        }
    }
};

/**
 * FSWrapWorker is meant to simplify adding async FSWorker instance methods to ObjectWrap types
 * like FileWrap and DirWrap, while keeping the object referenced during that action.
 */
template <typename Wrapper>
struct FSWrapWorker : public FSWorker
{
    Wrapper* _wrap;
    FSWrapWorker(const Napi::CallbackInfo& info)
        : FSWorker(info)
    {
        _wrap = Wrapper::Unwrap(info.This().As<Napi::Object>());
        _wrap->Ref();
    }
    ~FSWrapWorker()
    {
        _wrap->Unref();
    }
};

/**
 * Stat is an fs op
 *
 * Note: this stat operation contains the system call of open.
 *       Currently, we use it in list objects, but might want to create a different stat call
 *       (or add changes inside this) to avoid permission check during list objects
 *       while we stat each file (to avoid EACCES error)
 */
struct Stat : public FSWorker
{
    std::string _path;
    bool _use_lstat = false;
    struct stat _stat_res;
    XattrMap _xattr;
    std::vector<std::string> _xattr_get_keys;

    Stat(const Napi::CallbackInfo& info)
        : FSWorker(info)
    {
        _path = info[1].As<Napi::String>();
        if (info[2].ToBoolean()) {
            Napi::Object options = info[2].As<Napi::Object>();
            _use_lstat = options.Get("use_lstat").ToBoolean();
            load_xattr_get_keys(options, _xattr_get_keys);
        }
        Begin(XSTR() << "Stat " << DVAL(_path));
    }
    virtual void Work()
    {
        int flags = O_RDONLY; // This default will be used only for none-lstat cases
        // LINUX - using O_PATH with O_NOFOLLOW allow us to open the symlink itself
        // instead of openning the file it links to https://man7.org/linux/man-pages/man7/symlink.7.html
        // MAC - using O_SYMLINK (without O_NOFOLLOW!) allow us to open the symlink itself
        // https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/open.2.html
        // If O_NOFOLLOW is used in the mask and the target file passed to open() is a symbolic link then the open() will fail.
#ifdef __APPLE__
        if (_use_lstat) flags = O_SYMLINK;
#else
        if (_use_lstat) flags = O_PATH | O_NOFOLLOW;
#endif
        int fd = open(_path.c_str(), flags);
        CHECK_OPEN_FD(fd);
        SYSCALL_OR_RETURN(fstat(fd, &_stat_res));
        // With O_PATH The file itself is not opened, and other file operations (e.g., fgetxattr(2) - in our case),
        // fail with the error EBADF. https://man7.org/linux/man-pages/man2/open.2.html
        if (!_use_lstat) {
            SYSCALL_OR_RETURN(get_fd_xattr(fd, _xattr, _xattr_get_keys));
            if (use_gpfs_lib()) {
                GPFS_FCNTL_OR_RETURN(get_fd_gpfs_xattr(fd, _xattr, gpfs_error, _use_dmapi));
            }
        }

        if (_do_ctime_check) {
            CHECK_CTIME_CHANGE(fd, _stat_res, _path);
        }
    }
    virtual void OnOK()
    {
        DBG1("FS::Stat::OnOK: " << DVAL(_path) << DVAL(_stat_res.st_ino) << DVAL(_stat_res.st_size));
        Napi::Env env = Env();
        auto res = Napi::Object::New(env);
        set_stat_res(res, env, _stat_res, _xattr);
        _deferred.Resolve(res);
        ReportWorkerStats(0);
    }
};

/**
 * Statfs is an fs op
 */
struct Statfs : public FSWorker
{
    std::string _path;
    struct statfs _statfs_res;

    Statfs(const Napi::CallbackInfo& info)
        : FSWorker(info)
    {
        _path = info[1].As<Napi::String>();
        Begin(XSTR() << "Statfs " << DVAL(_path));
    }
    virtual void Work()
    {
        SYSCALL_OR_RETURN(statfs(_path.c_str(), &_statfs_res));
    }
    virtual void OnOK()
    {
        DBG1("FS::Statfs::OnOK: " << DVAL(_path) << DVAL(_statfs_res.f_type) << DVAL(_statfs_res.f_bsize));
        Napi::Env env = Env();
        auto res = Napi::Object::New(env);
        set_statfs_res(res, env, _statfs_res);
        _deferred.Resolve(res);
        ReportWorkerStats(0);
    }
};

/**
 * CheckAccess is an fs op
 */
struct CheckAccess : public FSWorker
{
    std::string _path;

    CheckAccess(const Napi::CallbackInfo& info)
        : FSWorker(info)
    {
        _path = info[1].As<Napi::String>();
        Begin(XSTR() << "CheckAccess " << DVAL(_path));
    }
    virtual void Work()
    {
        int fd = open(_path.c_str(), O_RDONLY);
        CHECK_OPEN_FD(fd);
    }
};

/**
 * Unlink is an fs op
 */
struct Unlink : public FSWorker
{
    std::string _path;
    Unlink(const Napi::CallbackInfo& info)
        : FSWorker(info)
    {
        _path = info[1].As<Napi::String>();
        Begin(XSTR() << "Unlink " << DVAL(_path));
    }
    virtual void Work()
    {
        SYSCALL_OR_RETURN(unlink(_path.c_str()));
    }
};

/**
 * Unlinkat is an fs op
 */
struct Unlinkat : public FSWorker
{
    int _dirfd;
    std::string _path;
    int _flags;
    Unlinkat(const Napi::CallbackInfo& info)
        : FSWorker(info)
        , _dirfd(0)
        , _flags(0)
    {
        _dirfd = info[1].As<Napi::Number>();
        _path = info[2].As<Napi::String>();
        _flags = info[3].As<Napi::Number>();
        Begin(XSTR() << "Unlinkat " << DVAL(_path) << DVAL(_dirfd) << DVAL(_flags));
    }
    virtual void Work()
    {
        SYSCALL_OR_RETURN(unlinkat(_dirfd, _path.c_str(), _flags));
    }
};

/**
 * Link is an fs op
 */
struct Link : public FSWorker
{
    std::string _oldpath;
    std::string _newpath;
    Link(const Napi::CallbackInfo& info)
        : FSWorker(info)
    {
        _oldpath = info[1].As<Napi::String>();
        _newpath = info[2].As<Napi::String>();
        Begin(XSTR() << "Link " << DVAL(_oldpath) << DVAL(_newpath));
    }
    virtual void Work()
    {
        SYSCALL_OR_RETURN(link(_oldpath.c_str(), _newpath.c_str()));
    }
};

/**
 * Linkat is an fs op
 */
struct Linkat : public FSWorker
{
    int _olddirfd;
    std::string _oldpath;
    int _newdirfd;
    std::string _newpath;
    int _flags;
    Linkat(const Napi::CallbackInfo& info)
        : FSWorker(info)
        , _olddirfd(0)
        , _newdirfd(0)
        , _flags(0)
    {
        _olddirfd = info[1].As<Napi::Number>();
        _oldpath = info[2].As<Napi::String>();
        _newdirfd = info[3].As<Napi::Number>();
        _newpath = info[4].As<Napi::String>();
        _flags = info[5].As<Napi::Number>();
        Begin(XSTR() << "Linkat " << DVAL(_oldpath) << DVAL(_olddirfd) << DVAL(_newpath) << DVAL(_newdirfd) << DVAL(_flags));
    }
    virtual void Work()
    {
        SYSCALL_OR_RETURN(linkat(_olddirfd, _oldpath.c_str(), _newdirfd, _newpath.c_str(), _flags));
    }
};

/**
 * Symlink is an fs op
 */
struct Symlink : public FSWorker
{
    std::string _target;
    std::string _linkpath;
    Symlink(const Napi::CallbackInfo& info)
        : FSWorker(info)
    {
        _target = info[1].As<Napi::String>();
        _linkpath = info[2].As<Napi::String>();
        Begin(XSTR() << "Symlink " << DVAL(_target) << DVAL(_linkpath));
    }
    virtual void Work()
    {
        SYSCALL_OR_RETURN(symlink(_target.c_str(), _linkpath.c_str()));
    }
};

/**
 * Mkdir is an fs op
 */
struct Mkdir : public FSWorker
{
    std::string _path;
    int _mode;
    Mkdir(const Napi::CallbackInfo& info)
        : FSWorker(info)
        , _mode(0777)
    {
        _path = info[1].As<Napi::String>();
        if (info.Length() > 2 && !info[2].IsUndefined()) {
            _mode = info[2].As<Napi::Number>().Uint32Value();
        }
        Begin(XSTR() << "Mkdir " << DVAL(_path) << DVAL(_mode));
    }
    virtual void Work()
    {
        SYSCALL_OR_RETURN(mkdir(_path.c_str(), _mode));
    }
};

/**
 * Rmdir is an fs op
 */
struct Rmdir : public FSWorker
{
    std::string _path;
    Rmdir(const Napi::CallbackInfo& info)
        : FSWorker(info)
    {
        _path = info[1].As<Napi::String>();
        Begin(XSTR() << "Rmdir " << DVAL(_path));
    }
    virtual void Work()
    {
        SYSCALL_OR_RETURN(rmdir(_path.c_str()));
    }
};

/**
 * SafeLink is an fs op
 * 1. link
 * 2. check if the target has the expected version
 *   2.1. if yes - return
 *   2.2. else - unlink and retry
 */
struct SafeLink : public FSWorker
{
    std::string _link_from;
    std::string _link_to;
    int64_t _link_expected_mtime;
    int64_t _link_expected_inode;
    SafeLink(const Napi::CallbackInfo& info)
        : FSWorker(info)
    {
        _link_from = info[1].As<Napi::String>();
        _link_to = info[2].As<Napi::String>();
        // TODO: handle lossless
        bool lossless = true;
        _link_expected_mtime = info[3].As<Napi::BigInt>().Int64Value(&lossless);
        _link_expected_inode = info[4].As<Napi::Number>().Int64Value();
        Begin(XSTR() << "SafeLink " << DVAL(_link_from.c_str()) << DVAL(_link_to.c_str()) << DVAL(_link_expected_mtime) << DVAL(_link_expected_inode));
    }
    virtual void Work()
    {
        SYSCALL_OR_RETURN(link(_link_from.c_str(), _link_to.c_str()));
        struct stat _stat_res;
        SYSCALL_OR_RETURN(stat(_link_to.c_str(), &_stat_res));
        if (cmp_ver_id(_link_expected_mtime, _link_expected_inode, _stat_res) == true) return;
        SYSCALL_OR_RETURN(unlink(_link_to.c_str()));
        DBG0("FS::SafeLink::Execute: ERROR link target doesn't match the expected inode + mtime" << DVAL(_link_to)
                                                                                                 << DVAL(_link_expected_mtime) << DVAL(_link_expected_inode));
        SetError(XSTR() << "FS::SafeLink ERROR link target doesn't match expected inode and mtime");
    }
};

/**
 * SafeUnlink is an fs op
 *  1. mv to tmp file
 *  2. check if the tmp file has the expected inode + mtime
 *   2.1. if yes - unlink
 *   2.2. else - mv back to source path and retry
 */
struct SafeUnlink : public FSWorker
{
    std::string _to_unlink;
    std::string _mv_to;
    int64_t _unlink_expected_mtime;
    int64_t _unlink_expected_inode;
    SafeUnlink(const Napi::CallbackInfo& info)
        : FSWorker(info)
    {
        _to_unlink = info[1].As<Napi::String>();
        _mv_to = info[2].As<Napi::String>();
        if (info.Length() > 4 && !info[3].IsUndefined() && !info[4].IsUndefined()) {
            // TODO: handle lossless
            bool lossless = true;
            _unlink_expected_mtime = info[3].As<Napi::BigInt>().Int64Value(&lossless);
            _unlink_expected_inode = info[4].As<Napi::Number>().Int64Value();
        }
        Begin(XSTR() << "SafeUnlink " << DVAL(_to_unlink) << DVAL(_mv_to) << DVAL(_unlink_expected_mtime) << DVAL(_unlink_expected_inode));
    }
    virtual void Work()
    {
        SYSCALL_OR_RETURN(rename(_to_unlink.c_str(), _mv_to.c_str()));
        struct stat _stat_res;
        SYSCALL_OR_RETURN(stat(_mv_to.c_str(), &_stat_res));
        if (cmp_ver_id(_unlink_expected_mtime, _unlink_expected_inode, _stat_res) == true) {
            SYSCALL_OR_RETURN(unlink(_mv_to.c_str()));
            return;
        }
        SYSCALL_OR_RETURN(link(_mv_to.c_str(), _to_unlink.c_str()));
        DBG0("FS::SafeUnlink::Execute: ERROR unlink target doesn't match the expected inode + mtime, retry"
            << DVAL(_to_unlink) << DVAL(_unlink_expected_mtime) << DVAL(_unlink_expected_inode));
        SetError(XSTR() << "FS::SafeUnlink ERROR unlink target doesn't match expected inode and mtime");
    }
};

/**
 * Rename is an fs op
 */
struct Rename : public FSWorker
{
    std::string _old_path;
    std::string _new_path;
    Rename(const Napi::CallbackInfo& info)
        : FSWorker(info)
    {
        _old_path = info[1].As<Napi::String>();
        _new_path = info[2].As<Napi::String>();
        Begin(XSTR() << "Rename " << DVAL(_old_path) << DVAL(_new_path));
    }
    virtual void Work()
    {
        SYSCALL_OR_RETURN(rename(_old_path.c_str(), _new_path.c_str()));
    }
};

/**
 * Writefile is an fs op
 */
struct Writefile : public FSWorker
{
    std::string _path;
    XattrMap _xattr;
    XattrMap _xattr_try;
    bool _set_xattr;
    bool _xattr_need_fsync;
    std::string _xattr_clear_prefix;
    const uint8_t* _data;
    size_t _len;
    mode_t _mode;
    Writefile(const Napi::CallbackInfo& info)
        : FSWorker(info)
        , _set_xattr(false)
        , _mode(0666)
    {
        _path = info[1].As<Napi::String>();
        auto buf = info[2].As<Napi::Buffer<uint8_t>>();
        _data = buf.Data();
        _len = buf.Length();
        if (info[3].ToBoolean()) {
            Napi::Object options = info[3].As<Napi::Object>();
            if (options.Get("mode").IsNumber()) _mode = options.Get("mode").As<Napi::Number>().Uint32Value();
            _xattr_need_fsync = options.Get("xattr_need_fsync").ToBoolean();
            if (options.Get("xattr_clear_prefix").ToBoolean()) {
                _xattr_clear_prefix = options.Get("xattr_clear_prefix").ToString();
            }
            if (options.Get("xattr").ToBoolean()) {
                _set_xattr = true;
                get_xattr_from_object(_xattr, options.Get("xattr").As<Napi::Object>());
            }
            if (options.Get("xattr_try").ToBoolean()) {
                _set_xattr = true;
                get_xattr_from_object(_xattr_try, options.Get("xattr_try").As<Napi::Object>());
            }
        }
        Begin(XSTR() << "Writefile " << DVAL(_path) << DVAL(_len) << DVAL(_mode));
    }
    virtual void Work()
    {
        int fd = open(_path.c_str(), O_TRUNC | O_CREAT | O_WRONLY, _mode);
        CHECK_OPEN_FD(fd);

        ssize_t len = write(fd, _data, _len);
        if (len < 0) {
            SetSyscallError();
        } else if ((size_t)len != _len) {
            SetError(XSTR() << "Writefile: partial write error " << DVAL(len) << DVAL(_len));
        }

        if (_set_xattr) {
            if (_xattr_need_fsync) {
                SYSCALL_OR_RETURN(fsync(fd));
            }
            if (_xattr_clear_prefix != "") {
                SYSCALL_OR_RETURN(clear_xattr(fd, _xattr_clear_prefix));
            }
            for (auto it = _xattr.begin(); it != _xattr.end(); ++it) {
                SYSCALL_OR_RETURN(fsetxattr(fd, it->first.c_str(), it->second.c_str(), it->second.length(), 0));
            }
            for (auto it = _xattr_try.begin(); it != _xattr_try.end(); ++it) {
                SYSCALL_OR_WARN(fsetxattr(fd, it->first.c_str(), it->second.c_str(), it->second.length(), 0));
            }
        }
    }
};

/**
 * Readfile is an fs op
 */
struct Readfile : public FSWorker
{
    std::string _path;
    bool _read_xattr;
    struct stat _stat_res;
    XattrMap _xattr;
    uint8_t* _data;
    int _len;
    std::vector<std::string> _xattr_get_keys;
    Readfile(const Napi::CallbackInfo& info)
        : FSWorker(info)
        , _read_xattr(false)
        , _data(0)
        , _len(0)
    {
        _path = info[1].As<Napi::String>();
        if (info[2].ToBoolean()) {
            Napi::Object options = info[2].As<Napi::Object>();
            _read_xattr = options.Get("read_xattr").ToBoolean();
            load_xattr_get_keys(options, _xattr_get_keys);
        }
        Begin(XSTR() << "Readfile " << DVAL(_path));
    }
    virtual ~Readfile()
    {
        buffer_releaser(NULL, _data);
        _data = 0;
    }
    /**
     * @brief Read the entire file at `_path` into an aligned in-memory buffer.
     *
     * Reads file metadata, optionally collects extended attributes, allocates an
     * aligned buffer sized to the file (`_len`), and fills it with the file's
     * contents. After reading, performs either a ctime or mtime change check
     * depending on `_do_ctime_check`.
     *
     * Populates member fields on success:
     * - `_stat_res` with the file stat,
     * - `_xattr` with extended attributes when `_read_xattr` is true (and GPFS
     *   xattrs via `use_gpfs_lib()` when available and `_use_dmapi` may be used),
     * - `_len` with the file size,
     * - `_data` with a pointer to the allocated, aligned buffer containing file data.
     *
     * On failure sets the worker error via SetError or SetSyscallError and returns
     * without populating the data buffer.
     *
     * @note Buffer allocation is performed with posix_memalign using
     *       `DIO_BUFFER_MEMALIGN`. If allocation fails or a syscall fails, an error
     *       is recorded.
     */
    virtual void Work()
    {
        int fd = open(_path.c_str(), O_RDONLY);
        CHECK_OPEN_FD(fd);
        SYSCALL_OR_RETURN(fstat(fd, &_stat_res));
        if (_read_xattr) {
            SYSCALL_OR_RETURN(get_fd_xattr(fd, _xattr, _xattr_get_keys));
            if (use_gpfs_lib()) {
                GPFS_FCNTL_OR_RETURN(get_fd_gpfs_xattr(fd, _xattr, gpfs_error, _use_dmapi));
            }
        }

        _len = _stat_res.st_size;
        int r = posix_memalign((void**)&_data, DIO_BUFFER_MEMALIGN, _len);
        if (r || (!_data && _len > 0)) {
            SetError(XSTR() << "FS::readFile: failed to allocate memory " << DVAL(_len) << DVAL(_path));
            return;
        }

        uint8_t* p = _data;
        int remain = _len;
        while (remain > 0) {
            ssize_t len = read(fd, p, remain);
            if (len < 0) {
                SetSyscallError();
                break;
            }
            remain -= len;
            p += len;
        }

        if (_do_ctime_check) {
            CHECK_CTIME_CHANGE(fd, _stat_res, _path);
        } else {
            CHECK_MTIME_CHANGE(fd, _stat_res, _path);
        }
    }
    /**
     * @brief Compose the successful result for a completed readfile operation and resolve the JavaScript promise.
     *
     * Constructs a JavaScript object with two properties:
     * - `stat`: file metadata populated from the worker's stat result.
     * - `data`: a Node.js `Buffer` that takes ownership of the read memory; ownership is transferred so the worker no longer frees it and `buffer_releaser` will release it when GC collects the buffer.
     *
     * After constructing the result object the function resolves the worker's deferred promise and reports worker statistics.
     */
    virtual void OnOK()
    {
        DBG1("FS::Readfile::OnOK: " << DVAL(_path));
        Napi::Env env = Env();

        auto res_stat = Napi::Object::New(env);
        set_stat_res(res_stat, env, _stat_res, _xattr);

        auto data = _data;
        _data = 0; // nullify so dtor will ignore, GC will call buffer_releaser
        auto buf = Napi::Buffer<uint8_t>::New(env, data, _len, buffer_releaser);

        auto res = Napi::Object::New(env);
        res["stat"] = res_stat;
        res["data"] = buf;
        _deferred.Resolve(res);
        ReportWorkerStats(0);
    }
};

/**
 * Readdir is an fs op
 */
struct Readdir : public FSWorker
{
    std::string _path;
    // bool _withFileTypes;
    std::vector<Entry> _entries;
    Readdir(const Napi::CallbackInfo& info)
        : FSWorker(info)
        , _entries(0)
    {
        _path = info[1].As<Napi::String>();
        // _withFileTypes = info[1].As<Napi::Boolean>();
        Begin(XSTR() << "Readdir " << DVAL(_path));
    }
    /**
     * @brief Reads directory entries from the path and appends them to `_entries`.
     *
     * Opens the directory at `_path`, iterates all entries, skips "." and "..", and for each entry
     * appends an Entry containing the name, inode, type, and directory offset to `_entries`.
     * On failure of opendir, readdir, or closedir, records the error by calling `SetSyscallError()`.
     */
    virtual void Work()
    {
        DIR* dir;
        dir = opendir(_path.c_str());
        if (dir == NULL) {
            SetSyscallError();
            return;
        }

        while (true) {
            // need to set errno before the call to readdir() to detect between EOF and error
            errno = 0;
            struct dirent* e = readdir(dir);
            if (e) {
                // Ignore parent and current directories
                if (strcmp(e->d_name, ".") == 0 || strcmp(e->d_name, "..") == 0) {
                    continue;
                }
                _entries.push_back(Entry{
                    std::string(e->d_name),
                    e->d_ino,
                    e->d_type,
                    e->DIR_OFFSET_FIELD,
                });
            } else {
                if (errno) SetSyscallError();
                break;
            }
        }

        int r = closedir(dir);
        if (r) SetSyscallError();
    }
    /**
     * @brief Resolve the worker's promise with an array of directory entry objects.
     *
     * Constructs a JavaScript array where each element is an object describing a
     * directory entry and resolves the worker's deferred promise with that array.
     *
     * Each directory entry object contains the following properties:
     * - `name`: entry name as a string.
     * - `ino`: inode number as a number.
     * - `type`: entry type (directory entry type constant) as a number.
     * - `off`: directory offset as a BigInt.
     *
     * The method also reports worker statistics after resolving the promise.
     */
    virtual void OnOK()
    {
        DBG1("FS::Readdir::OnOK: " << DVAL(_path));
        Napi::Env env = Env();
        Napi::Array res = Napi::Array::New(env, _entries.size());
        int index = 0;
        // if (_withFileTypes) {
        for (auto it = _entries.begin(); it != _entries.end(); ++it) {
            auto dir_rec = Napi::Object::New(env);
            dir_rec["name"] = Napi::String::New(env, it->name);
            dir_rec["ino"] = Napi::Number::New(env, it->ino);
            dir_rec["type"] = Napi::Number::New(env, it->type);
            dir_rec["off"] = Napi::BigInt::New(env, it->off);
            res[index] = dir_rec;
            index += 1;
        }
        // } else {
        //     for (auto it = _entries.begin(); it != _entries.end(); ++it) {
        //         res[index] = Napi::String::New(env, it->name);;
        //         index += 1;
        //     }
        // }
        _deferred.Resolve(res);
        ReportWorkerStats(0);
    }
};

/**
 * Fsync is an fs op
 */
struct Fsync : public FSWorker
{
    std::string _path;
    Fsync(const Napi::CallbackInfo& info)
        : FSWorker(info)
    {
        _path = info[1].As<Napi::String>();
        Begin(XSTR() << "Fsync " << DVAL(_path));
    }
    virtual void Work()
    {
        int fd = open(_path.c_str(), 0);
        CHECK_OPEN_FD(fd);
        SYSCALL_OR_RETURN(fsync(fd));
    }
};

/**
 * GetPwName is an os op
 */
struct GetPwName : public FSWorker
{
    std::string _user;
    struct passwd _pwd;
    struct passwd* _getpwnam_res;
    std::unique_ptr<char[]> _buf;
    /**
     * @brief Constructs a GetPwName worker that captures the target username from JS arguments.
     *
     * Initializes internal state and begins the worker with a descriptive name including the requested username.
     */
    GetPwName(const Napi::CallbackInfo& info)
        : FSWorker(info)
        , _getpwnam_res(NULL)
    {
        _user = info[1].As<Napi::String>();
        Begin(XSTR() << "GetPwName " << DVAL(_user));
    }
    virtual void Work()
    {
        const long passwd_buf_size = ThreadScope::get_passwd_buf_size();
        _buf.reset(new char[passwd_buf_size]);
        if (!_buf) {
            SetSyscallError();
            return;
        }
        int rc = getpwnam_r(_user.c_str(), &_pwd, _buf.get(), passwd_buf_size, &_getpwnam_res);
        if (rc != 0) {
            SetSyscallError();
            return;
        }
        if (_getpwnam_res == NULL) SetError("NO_SUCH_USER");
    }

    virtual void OnOK()
    {
        DBG1("FS::GetPwName::OnOK: " << DVAL(_user) << DVAL(_getpwnam_res->pw_uid) << DVAL(_getpwnam_res->pw_gid));
        Napi::Env env = Env();
        auto res = Napi::Object::New(env);
        set_getpwnam_res(env, res, *_getpwnam_res);
        _deferred.Resolve(res);
    }
};

struct FileWrap : public Napi::ObjectWrap<FileWrap>
{
    std::string _path;
    int _fd;
    static Napi::FunctionReference constructor;
    /**
     * @brief Initialize and register the JavaScript `File` class on the given N-API environment.
     *
     * Defines the `File` class with its instance methods and accessor and stores a persistent
     * constructor reference so the class remains available to JavaScript consumers.
     *
     * @param env N-API environment in which to define the `File` class.
     */
    static void init(Napi::Env env)
    {
        constructor = Napi::Persistent(DefineClass(
            env,
            "File",
            {
                InstanceMethod<&FileWrap::close>("close"),
                InstanceMethod<&FileWrap::read>("read"),
                InstanceMethod<&FileWrap::write>("write"),
                InstanceMethod<&FileWrap::writev>("writev"),
                InstanceMethod<&FileWrap::read_rdma>("read_rdma"),
                InstanceMethod<&FileWrap::write_rdma>("write_rdma"),
                InstanceMethod<&FileWrap::replacexattr>("replacexattr"),
                InstanceMethod<&FileWrap::linkfileat>("linkfileat"),
                InstanceMethod<&FileWrap::unlinkfileat>("unlinkfileat"),
                InstanceMethod<&FileWrap::stat>("stat"),
                InstanceMethod<&FileWrap::fsync>("fsync"),
                InstanceMethod<&FileWrap::flock>("flock"),
                InstanceMethod<&FileWrap::fcntllock>("fcntllock"),
                InstanceAccessor<&FileWrap::getfd>("fd"),
            }));
        constructor.SuppressDestruct();
    }
    FileWrap(const Napi::CallbackInfo& info)
        : Napi::ObjectWrap<FileWrap>(info)
        , _fd(-1)
    {
    }
    ~FileWrap()
    {
        if (_fd >= 0) {
            LOG("FS::FileWrap::dtor: file not closed " << DVAL(_path) << DVAL(_fd));
            int r = ::close(_fd);
            if (r) LOG("FS::FileWrap::dtor: file close failed " << DVAL(_path) << DVAL(_fd) << DVAL(r));
            _fd = -1;
        }
    }
    Napi::Value close(const Napi::CallbackInfo& info);
    Napi::Value read(const Napi::CallbackInfo& info);
    Napi::Value write(const Napi::CallbackInfo& info);
    Napi::Value writev(const Napi::CallbackInfo& info);
    Napi::Value read_rdma(const Napi::CallbackInfo& info);
    Napi::Value write_rdma(const Napi::CallbackInfo& info);
    Napi::Value replacexattr(const Napi::CallbackInfo& info);
    Napi::Value linkfileat(const Napi::CallbackInfo& info);
    Napi::Value unlinkfileat(const Napi::CallbackInfo& info);
    Napi::Value stat(const Napi::CallbackInfo& info);
    Napi::Value fsync(const Napi::CallbackInfo& info);
    Napi::Value getfd(const Napi::CallbackInfo& info);
    Napi::Value flock(const Napi::CallbackInfo& info);
    Napi::Value fcntllock(const Napi::CallbackInfo& info);
};

Napi::FunctionReference FileWrap::constructor;

struct FileOpen : public FSWorker
{
    std::string _path;
    int _fd;
    int _flags;
    mode_t _mode;
    FileOpen(const Napi::CallbackInfo& info)
        : FSWorker(info)
        , _fd(-1)
        , _flags(0)
        , _mode(0666)
    {
        _path = info[1].As<Napi::String>();
        if (info.Length() > 2 && !info[2].IsUndefined()) {
            _flags = parse_open_flags(info[2].As<Napi::String>());
            if (_flags < 0) SetError("Unexpected open flags");
        }
        if (info.Length() > 3 && !info[3].IsUndefined()) {
            _mode = info[3].As<Napi::Number>().Uint32Value();
        }
        Begin(XSTR() << "FileOpen " << DVAL(_path) << DVAL(_flags) << DVAL(_mode));
    }
    virtual void Work()
    {
        _fd = open(_path.c_str(), _flags, _mode);
        if (_fd < 0) SetSyscallError();
    }
    virtual void OnOK()
    {
        DBG1("FS::FileOpen::OnOK: " << DVAL(_path));
        Napi::Object res = FileWrap::constructor.New({});
        FileWrap* w = FileWrap::Unwrap(res);
        w->_path = _path;
        w->_fd = _fd;
        _deferred.Resolve(res);
        ReportWorkerStats(0);
    }
};

struct FileClose : public FSWrapWorker<FileWrap>
{
    FileClose(const Napi::CallbackInfo& info)
        : FSWrapWorker<FileWrap>(info)
    {
        Begin(XSTR() << "FileClose " << DVAL(_wrap->_path) << DVAL(_wrap->_fd));
    }
    virtual void Work()
    {
        int fd = _wrap->_fd;
        if (fd >= 0) {
            std::string path = _wrap->_path;
            int r = close(fd);
            if (r) SetSyscallError();
            _wrap->_fd = -1;
        }
    }
};

struct FileRead : public FSWrapWorker<FileWrap>
{
    uint8_t* _buf;
    int _offset;
    int _len;
    off_t _pos;
    ssize_t _br;
    FileRead(const Napi::CallbackInfo& info)
        : FSWrapWorker<FileWrap>(info)
        , _buf(0)
        , _offset(0)
        , _len(0)
        , _pos(0)
        , _br(0)
    {
        auto buf = info[1].As<Napi::Buffer<uint8_t>>();
        _buf = buf.Data();
        _offset = info[2].As<Napi::Number>();
        _len = info[3].As<Napi::Number>();
        _pos = info[4].As<Napi::Number>();
        Begin(XSTR() << "FileRead " << DVAL(_wrap->_path) << DVAL(_wrap->_fd) << DVAL(_pos) << DVAL(_offset) << DVAL(_len));
    }
    /**
     * @brief Reads from the wrapped file descriptor into the worker's buffer at the specified buffer offset and file position.
     *
     * Performs a positional read using the FileWrap's file descriptor; on success stores the number of bytes read in `_br`. On failure records a syscall error via `SetSyscallError()`.
     */
    virtual void Work()
    {
        int fd = _wrap->_fd;
        CHECK_WRAP_FD(fd);
        _br = pread(fd, _buf + _offset, _len, _pos);
        if (_br < 0) {
            SetSyscallError();
            return;
        }
    }
    /**
     * @brief Resolve the worker's promise with the number of bytes read and report worker statistics.
     *
     * Resolves the stored deferred Promise with the read byte count and calls ReportWorkerStats with a 0 status.
     */
    virtual void OnOK()
    {
        DBG1("FS::FileRead::OnOK: " << DVAL(_wrap->_path));
        Napi::Env env = Env();
        _deferred.Resolve(Napi::Number::New(env, _br));
        ReportWorkerStats(0);
    }
};

struct FileWrite : public FSWrapWorker<FileWrap>
{
    const uint8_t* _buf;
    size_t _len;
    off_t _offset;
    FileWrite(const Napi::CallbackInfo& info)
        : FSWrapWorker<FileWrap>(info)
        , _buf(0)
        , _len(0)
        , _offset(-1)
    {
        auto buf = info[1].As<Napi::Buffer<uint8_t>>();
        _buf = buf.Data();
        _len = buf.Length();
        if (info.Length() > 3 && !info[3].IsUndefined()) {
            _offset = info[3].As<Napi::Number>();
        }
        Begin(XSTR() << "FileWrite " << DVAL(_wrap->_path) << DVAL(_len) << DVAL(_offset));
    }
    virtual void Work()
    {
        int fd = _wrap->_fd;
        CHECK_WRAP_FD(fd);
        ssize_t bw = -1;
        if (_offset >= 0) {
            bw = pwrite(fd, _buf, _len, _offset);
        } else {
            bw = write(fd, _buf, _len);
        }
        if (bw < 0) {
            SetSyscallError();
        } else if ((size_t)bw != _len) {
            SetError(XSTR() << "FS::FileWrite::Execute: partial write error " << DVAL(bw) << DVAL(_len));
        }
    }
};

struct FileWritev : public FSWrapWorker<FileWrap>
{
    std::vector<struct iovec> iov_vec;
    ssize_t _total_len;
    off_t _offset;
    FileWritev(const Napi::CallbackInfo& info)
        : FSWrapWorker<FileWrap>(info)
        , _total_len(0)
        , _offset(-1)
    {
        auto buffers = info[1].As<Napi::Array>();
        const int buffers_len = buffers.Length();
        iov_vec.resize(buffers_len);
        struct iovec iov;
        for (int i = 0; i < buffers_len; ++i) {
            Napi::Value buf_val = buffers[i];
            auto buf = buf_val.As<Napi::Buffer<uint8_t>>();
            iov.iov_base = buf.Data();
            iov.iov_len = buf.Length();
            iov_vec[i] = iov;
            _total_len += iov.iov_len;
        }
        if (info.Length() > 2 && !info[2].IsUndefined()) {
            _offset = info[2].As<Napi::Number>();
        }
        Begin(XSTR() << "FileWritev " << DVAL(_wrap->_path) << DVAL(_total_len) << DVAL(buffers_len) << DVAL(_offset));
    }
    /**
     * @brief Performs the vectorized write to the underlying file descriptor.
     *
     * Writes the provided iovec buffers to the wrapper's file descriptor using `pwritev`
     * when an offset is specified or `writev` when no offset is provided. On syscall
     * failure the worker error state is set with the corresponding system error; if
     * the written byte count does not match the expected total length the worker is
     * marked with an error describing the partial write.
     */
    virtual void Work()
    {
        int fd = _wrap->_fd;
        CHECK_WRAP_FD(fd);
        ssize_t bw = -1;
        if (_offset >= 0) {
            bw = pwritev(fd, iov_vec.data(), iov_vec.size(), _offset);
        } else {
            bw = writev(fd, iov_vec.data(), iov_vec.size());
        }
        if (bw < 0) {
            SetSyscallError();
        } else if (bw != _total_len) {
            // TODO: Handle partial writes as well and not fail the operation
            SetError(XSTR() << "FS::FileWritev::Execute: partial writev error " << DVAL(bw) << DVAL(_total_len));
        }
    }
};

#define RDMA_DEFAULT_DC_KEY (0xffeeddcc)

/**
 * @brief Populate GPFS RDMA parameters from a JavaScript object and adjust sizes/offsets.
 *
 * Extracts RDMA connection and transfer parameters from the provided N-API object into
 * the supplied gpfs_rdma_info_t structure, and sets the transfer byte count and file
 * offset. If an `offset` field is present in `params`, it is applied to both the
 * remote virtual address and the file offset (sliding-window adjustment).
 *
 * @param params JavaScript object containing RDMA fields (e.g. `addr`, `rkey`, `lid`, `qp_num`, `gid0`, `gid1`, `dc_key`, `fab_num`, `size`, `file_offset`, `offset`).
 * @param[out] _rdma_info Filled gpfs_rdma_info_t describing the remote DC endpoint and keys.
 * @param[out] _count Set to the requested transfer size (`size` field).
 * @param[out] _file_offset Set to the requested file offset (`file_offset` field), then incremented by `offset` if provided.
 */
static void
init_gpfs_rdma_params(
    Napi::Object params,
    gpfs_rdma_info_t& _rdma_info,
    gpfs_size64_t& _count,
    gpfs_off64_t& _file_offset)
{
    memset(&_rdma_info, 0, sizeof _rdma_info);
    _rdma_info.gpfs_rdma_info_type = GPFS_RDMA_INFO_TYPE_DC;
    _rdma_info.rdma_info_dc.rem_vaddr = napi_get_u64_hex(params, "addr");
    _rdma_info.rdma_info_dc.rkey = napi_get_u32(params, "rkey");
    _rdma_info.rdma_info_dc.lid = napi_get_u32(params, "lid");
    _rdma_info.rdma_info_dc.qp_num = napi_get_u32(params, "qp_num");
    _rdma_info.rdma_info_dc.gid[0] = napi_get_u64_hex_or(params, "gid0", 0);
    _rdma_info.rdma_info_dc.gid[1] = napi_get_u64_hex_or(params, "gid1", 0);
    _rdma_info.rdma_info_dc.dc_key = napi_get_u32_or(params, "dc_key", RDMA_DEFAULT_DC_KEY);
    _rdma_info.rdma_info_dc.fab_num = napi_get_i32_or(params, "fab_num", GPFS_RDMA_FABRIC_ANY);
    _count = napi_get_i64(params, "size");
    _file_offset = napi_get_i64(params, "file_offset");
    int64_t offset = napi_get_i64(params, "offset");
    // NOTICE - we apply same offset to *both* the remote addr and file offset, like a sliding window
    _rdma_info.rdma_info_dc.rem_vaddr += offset;
    _file_offset += offset;
}

struct FileReadRdma : public FSWrapWorker<FileWrap>
{
    gpfs_rdma_info_t _rdma_info;
    gpfs_size64_t _count;
    gpfs_off64_t _file_offset;
    gpfs_ssize64_t _result;
    /**
     * @brief Constructs a FileReadRdma async worker that performs a GPFS RDMA read.
     *
     * Initializes RDMA parameters from the JS callback info, validates that the
     * GPFS RDMA pread symbol is available, and begins the worker with a descriptive
     * name including the target path, byte count, and file offset.
     *
     * @param info N-API callback info whose second argument (info[1]) is an object
     *             containing RDMA parameters parsed by init_gpfs_rdma_params.
     *
     * @throws Napi::Error if the GPFS RDMA pread symbol is not supported on the system.
     */
    FileReadRdma(const Napi::CallbackInfo& info)
        : FSWrapWorker<FileWrap>(info)
        , _count(0)
        , _file_offset(0)
        , _result(-1)
    {
        if (!dlsym_gpfs_rdma_pread) {
            throw napi_sys_error(info.Env(), "gpfs_rdma_pread not supported", EOPNOTSUPP);
        }
        Napi::Object params = info[1].As<Napi::Object>();
        init_gpfs_rdma_params(params, _rdma_info, _count, _file_offset);
        Begin(XSTR() << "FileReadRdma " << DVAL(_wrap->_path) << DVAL(_count) << DVAL(_file_offset));
    }
    /**
     * @brief Performs an RDMA read from the wrapped file into the RDMA buffer.
     *
     * Executes a GPFS RDMA pread using the worker's configured file offset, count, and RDMA parameters,
     * stores the number of bytes read in `_result`, and records a syscall error if the operation fails.
     */
    virtual void Work()
    {
        int fd = _wrap->_fd;
        CHECK_WRAP_FD(fd);
        _result = dlsym_gpfs_rdma_pread(fd, _count, _file_offset, &_rdma_info);
        if (_result < 0) {
            SetSyscallError();
            return;
        }
    }
    /**
     * @brief Finalize a successful RDMA file read operation.
     *
     * Resolves the associated JavaScript promise with the number of bytes read
     * and reports worker statistics.
     */
    virtual void OnOK()
    {
        DBG1("FS::FileReadRdma::OnOK: " << DVAL(_wrap->_path) << DVAL(_result));
        _deferred.Resolve(Napi::Number::New(Env(), _result));
        ReportWorkerStats(0);
    }
};

struct FileWriteRdma : public FSWrapWorker<FileWrap>
{
    gpfs_rdma_info_t _rdma_info;
    gpfs_size64_t _count;
    gpfs_off64_t _file_offset;
    gpfs_ssize64_t _result;
    /**
     * @brief Constructs a worker that performs an RDMA-based write (gpfs_rdma_pwrite) for a FileWrap.
     *
     * Initializes internal RDMA parameters from the provided JS callback arguments and begins the async
     * worker with a descriptive operation name.
     *
     * @param info N-API callback info whose argument at index 1 must be an object of RDMA parameters
     *             used to initialize the underlying `gpfs_rdma_info_t`, and which also provides the
     *             target write count and file offset.
     *
     * @throws Napi::Error Thrown with code `EOPNOTSUPP` if `gpfs_rdma_pwrite` is not available.
     */
    FileWriteRdma(const Napi::CallbackInfo& info)
        : FSWrapWorker<FileWrap>(info)
        , _count(0)
        , _file_offset(0)
        , _result(-1)
    {
        if (!dlsym_gpfs_rdma_pwrite) {
            throw napi_sys_error(info.Env(), "gpfs_rdma_pwrite not supported", EOPNOTSUPP);
        }
        Napi::Object params = info[1].As<Napi::Object>();
        init_gpfs_rdma_params(params, _rdma_info, _count, _file_offset);
        Begin(XSTR() << "FileWriteRdma " << DVAL(_wrap->_path) << DVAL(_count) << DVAL(_file_offset));
    }
    /**
     * @brief Perform an RDMA-backed pwrite through the GPFS RDMA provider.
     *
     * Executes a GPFS RDMA pwrite using the worker's file descriptor, requested
     * byte count, file offset, and RDMA parameters, and stores the returned
     * result in the worker's `_result` field.
     *
     * On error, `_result` will be negative and the worker's syscall error state
     * will be recorded via SetSyscallError().
     */
    virtual void Work()
    {
        int fd = _wrap->_fd;
        CHECK_WRAP_FD(fd);
        _result = dlsym_gpfs_rdma_pwrite(fd, _count, _file_offset, &_rdma_info);
        if (_result < 0) {
            SetSyscallError();
            return;
        }
    }
    /**
     * @brief Finalizes a successful RDMA file write operation.
     *
     * Resolves the worker's deferred promise with the number of bytes written and reports worker statistics indicating no error.
     */
    virtual void OnOK()
    {
        DBG1("FS::FileWriteRdma::OnOK: " << DVAL(_wrap->_path) << DVAL(_result));
        _deferred.Resolve(Napi::Number::New(Env(), _result));
        ReportWorkerStats(0);
    }
};

/**
 * TODO: Not atomic and might cause partial updates of MD
 */
struct FileReplacexattr : public FSWrapWorker<FileWrap>
{
    XattrMap _xattr;
    std::string _prefix;
    FileReplacexattr(const Napi::CallbackInfo& info)
        : FSWrapWorker<FileWrap>(info)
        , _prefix("")
    {
        if (info.Length() > 1 && !info[1].IsUndefined()) {
            get_xattr_from_object(_xattr, info[1].As<Napi::Object>());
        }
        if (info.Length() > 2 && !info[2].IsUndefined()) {
            _prefix = info[2].As<Napi::String>();
        }
        Begin(XSTR() << "FileReplacexattr " << DVAL(_wrap->_path));
    }
    virtual void Work()
    {
        int fd = _wrap->_fd;
        CHECK_WRAP_FD(fd);

        if (_prefix != "") {
            SYSCALL_OR_RETURN(clear_xattr(fd, _prefix));
        }

        for (auto it = _xattr.begin(); it != _xattr.end(); ++it) {
            SYSCALL_OR_RETURN(fsetxattr(fd, it->first.c_str(), it->second.c_str(), it->second.length(), 0));
        }
    }
};

struct LinkFileAt : public FSWrapWorker<FileWrap>
{
    std::string _filepath;
    int _replace_fd;
    bool _should_not_override;
    /**
     * @brief Constructs a LinkFileAt worker to create a hard link from the wrapped file to a target path.
     *
     * Parses arguments from the JS callback info to configure the link operation:
     * - info[1]: destination path (string).
     * - info[2] (optional): file descriptor of an existing file to replace (number). If omitted or negative, no replace FD is used.
     * - info[3] (optional): when true, indicates the operation must not override an existing target (boolean).
     *
     * When a replace FD is not provided and `should_not_override` is true, thread capabilities are elevated to allow linkat operations from non-root users.
     *
     * @param info JavaScript callback arguments (see description for expected indices and types).
     */
    LinkFileAt(const Napi::CallbackInfo& info)
        : FSWrapWorker<FileWrap>(info)
        , _replace_fd(-1)
        , _should_not_override(false)
    {
        _filepath = info[1].As<Napi::String>();
        if (info.Length() > 2 && !info[2].IsUndefined()) {
            _replace_fd = info[2].As<Napi::Number>();
        }
        if (info.Length() > 3 && !info[3].IsUndefined()) {
            _should_not_override = info[3].As<Napi::Boolean>();
        }
        if (_replace_fd < 0 && _should_not_override) {
            // set thread capabilities to allow linkat from user other than root.
            AddThreadCapabilities();
        }
        Begin(XSTR() << "LinkFileAt " << DVAL(_wrap->_path) << DVAL(_wrap->_fd) << DVAL(_filepath) << DVAL(_should_not_override));
    }
    /**
     * @brief Create a hard link from the wrapped file descriptor to the target path.
     *
     * Creates a hard link pointing at the file represented by this worker's FileWrap
     * to _filepath. Behavior depends on the worker flags:
     * - If _replace_fd >= 0, replace the target atomically using the provided descriptor.
     * - If _should_not_override is true, do not overwrite an existing target (fail if it exists).
     * - Otherwise, create the link (overwriting the target if the underlying syscall permits).
     */
    virtual void Work()
    {
        int fd = _wrap->_fd;
        CHECK_WRAP_FD(fd);

        // gpfs_linkat() is the same as Linux linkat() but we need a new function because
        // Linux will fail the linkat() if the file already exist and we want to replace it if it existed.
        if (_replace_fd >= 0) {
            SYSCALL_OR_RETURN(dlsym_gpfs_linkatif(fd, "", AT_FDCWD, _filepath.c_str(), AT_EMPTY_PATH, _replace_fd));
        } else if (_should_not_override) {
            SYSCALL_OR_RETURN(linkat(fd, "", AT_FDCWD, _filepath.c_str(), AT_EMPTY_PATH));
        } else {
            SYSCALL_OR_RETURN(dlsym_gpfs_linkat(fd, "", AT_FDCWD, _filepath.c_str(), AT_EMPTY_PATH));
        }
    }
};

struct UnlinkFileAt : public FSWrapWorker<FileWrap>
{
    std::string _filepath;
    int _delete_fd;
    UnlinkFileAt(const Napi::CallbackInfo& info)
        : FSWrapWorker<FileWrap>(info)
        , _delete_fd(-1)
    {
        _filepath = info[1].As<Napi::String>();
        if (info.Length() > 2 && !info[2].IsUndefined()) {
            _delete_fd = info[2].As<Napi::Number>();
        }
        Begin(XSTR() << "UnlinkFileAt" << DVAL(_wrap->_path.c_str()) << DVAL(_wrap->_fd) << DVAL(_filepath) << DVAL(_delete_fd));
    }
    virtual void Work()
    {
        int fd = _wrap->_fd;
        CHECK_WRAP_FD(fd);
        SYSCALL_OR_RETURN(dlsym_gpfs_unlinkat(fd, _filepath.c_str(), _delete_fd));
    }
};

struct FileStat : public FSWrapWorker<FileWrap>
{
    struct stat _stat_res;
    XattrMap _xattr;
    std::vector<std::string> _xattr_get_keys;

    FileStat(const Napi::CallbackInfo& info)
        : FSWrapWorker<FileWrap>(info)
    {
        if (info[1].ToBoolean()) {
            Napi::Object options = info[1].As<Napi::Object>();
            load_xattr_get_keys(options, _xattr_get_keys);
        }

        Begin(XSTR() << "FileStat " << DVAL(_wrap->_path));
    }
    virtual void Work()
    {
        int fd = _wrap->_fd;
        CHECK_WRAP_FD(fd);
        SYSCALL_OR_RETURN(fstat(fd, &_stat_res));
        SYSCALL_OR_RETURN(get_fd_xattr(fd, _xattr, _xattr_get_keys));
        if (use_gpfs_lib()) {
            GPFS_FCNTL_OR_RETURN(get_fd_gpfs_xattr(fd, _xattr, gpfs_error, _use_dmapi));
        }

        if (_do_ctime_check) {
            CHECK_CTIME_CHANGE(fd, _stat_res, _wrap->_path);
        }
    }
    virtual void OnOK()
    {
        DBG1("FS::FileStat::OnOK: FileStat " << DVAL(_stat_res.st_ino) << DVAL(_stat_res.st_size));
        Napi::Env env = Env();
        auto res = Napi::Object::New(env);
        set_stat_res(res, env, _stat_res, _xattr);
        _deferred.Resolve(res);
        ReportWorkerStats(0);
    }
};

struct FileFsync : public FSWrapWorker<FileWrap>
{
    FileFsync(const Napi::CallbackInfo& info)
        : FSWrapWorker<FileWrap>(info)
    {
        Begin(XSTR() << "FileFsync " << DVAL(_wrap->_path));
    }
    virtual void Work()
    {
        int fd = _wrap->_fd;
        CHECK_WRAP_FD(fd);
        SYSCALL_OR_RETURN(fsync(fd));
    }
};

struct FileFlock : public FSWrapWorker<FileWrap>
{
    int lock_mode;
    /**
     * @brief Constructs a FileFlock worker and configures the requested lock mode.
     *
     * Parses an optional second argument (string) to select the lock mode and records the operation description.
     *
     * Accepted lock mode strings:
     * - "EXCLUSIVE" — exclusive lock
     * - "SHARED" — shared lock (default)
     * - "UNLOCK" — release lock
     *
     * If an invalid mode string is provided, the worker is marked with an error.
     */
    FileFlock(const Napi::CallbackInfo& info)
        : FSWrapWorker<FileWrap>(info)
        , lock_mode(LOCK_SH)
    {
        if (info.Length() > 1 && !info[1].IsUndefined()) {
            auto mode = info[1].As<Napi::String>().Utf8Value();
            if (mode == "EXCLUSIVE") {
                lock_mode = LOCK_EX;
            } else if (mode == "UNLOCK") {
                lock_mode = LOCK_UN;
            } else if (mode == "SHARED") {
                lock_mode = LOCK_SH;
            } else {
                SetError("invalid lock type");
            }
        }

        Begin(XSTR() << "FileFlock " << DVAL(_wrap->_path));
    }
    virtual void Work()
    {
        int fd = _wrap->_fd;
        CHECK_WRAP_FD(fd);
        SYSCALL_OR_RETURN(flock(fd, lock_mode));
    }
};

struct FileFcntlLock : public FSWrapWorker<FileWrap>
{
    struct flock fl;
    FileFcntlLock(const Napi::CallbackInfo& info)
        : FSWrapWorker<FileWrap>(info)
        , fl()
    {
        // lock entire file
        fl.l_whence = SEEK_SET;
        fl.l_start = 0;
        fl.l_len = 0;
        fl.l_pid = 0;
        fl.l_type = F_RDLCK;

        if (info.Length() > 1 && !info[1].IsUndefined()) {
            auto mode = info[1].As<Napi::String>().Utf8Value();
            if (mode == "EXCLUSIVE") {
                fl.l_type = F_WRLCK;
            } else if (mode == "UNLOCK") {
                fl.l_type = F_UNLCK;
            } else if (mode == "SHARED") {
                fl.l_type = F_RDLCK;
            } else {
                SetError("invalid lock type");
            }
        }

        Begin(XSTR() << "FileFcntlLock" << DVAL(_wrap->_path));
    }
    virtual void Work()
    {
        int fd = _wrap->_fd;
        CHECK_WRAP_FD(fd);
        // This uses F_OFD_SETLKW instead for discussion related to this choice
        // refer: https://github.com/noobaa/noobaa-core/pull/8174
        SYSCALL_OR_RETURN(fcntl(fd, F_OFD_SETLKW, &fl));
    }
};

struct RealPath : public FSWorker
{
    std::string _path;
    char* _full_path;

    RealPath(const Napi::CallbackInfo& info)
        : FSWorker(info)
        , _full_path(0)
    {
        _path = info[1].As<Napi::String>();
        Begin(XSTR() << "RealPath " << DVAL(_path));
    }

    ~RealPath()
    {
        if (_full_path) {
            free(_full_path);
            _full_path = 0;
        }
    }

    virtual void Work()
    {
        // realpath called with resolved_path = NULL so it will malloc as needed for the result
        // and we just need to make sure to capture this result and remember to free it on dtor.
        _full_path = realpath(_path.c_str(), NULL);
        if (!_full_path) SetSyscallError();
    }

    virtual void OnOK()
    {
        DBG1("FS::RealPath::OnOK: " << DVAL(_path) << DVAL(_full_path));
        Napi::Env env = Env();
        auto res = Napi::String::New(env, _full_path);
        _deferred.Resolve(res);
        ReportWorkerStats(0);
    }
};

struct GetSingleXattr : public FSWorker
{
    std::string _path;
    std::string _key;
    std::string _val;

    GetSingleXattr(const Napi::CallbackInfo& info)
        : FSWorker(info)
    {
        _path = info[1].As<Napi::String>();
        _key = info[2].As<Napi::String>();
        Begin(XSTR() << "GetSingleXattr" << DVAL(_path) << DVAL(_key));
    }

    virtual void Work()
    {
        ssize_t value_len = getxattr(_path.c_str(), _key.c_str(), NULL, 0);

        if (value_len == -1) {
            SetSyscallError();
            return;
        }

        if (value_len > 0) {
            Buf val(value_len);
            value_len = getxattr(_path.c_str(), _key.c_str(), val.cdata(), value_len);
            if (value_len == -1) {
                SetSyscallError();
                return;
            }

            _val = std::string(val.cdata(), value_len);
        } else if (value_len == 0) {
            _val = "";
        }
    }

    virtual void OnOK()
    {
        DBG1("FS::GetSingleXattr::OnOK: " << DVAL(_path) << DVAL(_val));
        Napi::Env env = Env();
        auto res = Napi::String::New(env, _val);
        _deferred.Resolve(res);
        ReportWorkerStats(0);
    }
};

Napi::Value
FileWrap::close(const Napi::CallbackInfo& info)
{
    return api<FileClose>(info);
}

Napi::Value
FileWrap::read(const Napi::CallbackInfo& info)
{
    return api<FileRead>(info);
}

Napi::Value
FileWrap::write(const Napi::CallbackInfo& info)
{
    return api<FileWrite>(info);
}

/**
 * @brief Enqueues a vectored write operation on this file.
 *
 * Performs a writev (multiple-buffer write) according to the provided callback arguments.
 *
 * @return The number of bytes written.
 */
Napi::Value
FileWrap::writev(const Napi::CallbackInfo& info)
{
    return api<FileWritev>(info);
}

/**
 * @brief Initiates an RDMA-backed read operation on this FileWrap.
 *
 * @return Napi::Value A JavaScript value representing the started RDMA read operation. On success the operation yields an object with fields `bytes` (number of bytes read) and `buffer` (the read data as a Node.js Buffer); on failure it results in an error.
 */
Napi::Value
FileWrap::read_rdma(const Napi::CallbackInfo& info)
{
    return api<FileReadRdma>(info);
}

/**
 * Queue an RDMA-capable write operation bound to this FileWrap.
 *
 * @param info The JavaScript call arguments and execution context.
 * @return Napi::Value The JavaScript value representing the initiated `write_rdma` operation.
 */
Napi::Value
FileWrap::write_rdma(const Napi::CallbackInfo& info)
{
    return api<FileWriteRdma>(info);
}

/**
 * @brief Enqueue a replace-xattr operation for this FileWrap instance.
 *
 * Starts an operation that replaces extended attributes on the file represented
 * by this FileWrap.
 *
 * @return Napi::Value JavaScript handle for the initiated operation.
 */
Napi::Value
FileWrap::replacexattr(const Napi::CallbackInfo& info)
{
    return api<FileReplacexattr>(info);
}

Napi::Value
FileWrap::linkfileat(const Napi::CallbackInfo& info)
{
    return api<LinkFileAt>(info);
}

Napi::Value
FileWrap::unlinkfileat(const Napi::CallbackInfo& info)
{
    return api<UnlinkFileAt>(info);
}

Napi::Value
FileWrap::getfd(const Napi::CallbackInfo& info)
{
    return Napi::Number::New(info.Env(), this->_fd);
}

Napi::Value
FileWrap::stat(const Napi::CallbackInfo& info)
{
    return api<FileStat>(info);
}

Napi::Value
FileWrap::fsync(const Napi::CallbackInfo& info)
{
    return api<FileFsync>(info);
}

Napi::Value
FileWrap::flock(const Napi::CallbackInfo& info)
{
    return api<FileFlock>(info);
}

Napi::Value
FileWrap::fcntllock(const Napi::CallbackInfo& info)
{
    return api<FileFcntlLock>(info);
}

/**
 *
 */
struct DirWrap : public Napi::ObjectWrap<DirWrap>
{
    std::string _path;
    DIR* _dir;
    static Napi::FunctionReference constructor;
    static void init(Napi::Env env)
    {
        constructor = Napi::Persistent(DefineClass(
            env,
            "Dir",
            {
                InstanceMethod("close", &DirWrap::close),
                InstanceMethod("read", &DirWrap::read),
                InstanceMethod("telldir", &DirWrap::telldir),
                InstanceMethod("seekdir", &DirWrap::seekdir),
            }));
        constructor.SuppressDestruct();
    }
    DirWrap(const Napi::CallbackInfo& info)
        : Napi::ObjectWrap<DirWrap>(info)
        , _dir(0)
    {
    }
    ~DirWrap()
    {
        if (_dir) {
            LOG("FS::DirWrap::dtor: dir not closed " << DVAL(_path) << DVAL(_dir));
            int r = closedir(_dir);
            if (r) LOG("FS::DirWrap::dtor: dir close failed " << DVAL(_path) << DVAL(_dir) << DVAL(r));
            _dir = 0;
        }
    }
    Napi::Value close(const Napi::CallbackInfo& info);
    Napi::Value read(const Napi::CallbackInfo& info);
    Napi::Value telldir(const Napi::CallbackInfo& info);
    Napi::Value seekdir(const Napi::CallbackInfo& info);
};

Napi::FunctionReference DirWrap::constructor;

struct DirOpen : public FSWorker
{
    std::string _path;
    DIR* _dir;
    DirOpen(const Napi::CallbackInfo& info)
        : FSWorker(info)
        , _dir(0)
    {
        _path = info[1].As<Napi::String>();
        // TODO - info[1] = { bufferSize: 128 }
        Begin(XSTR() << "DirOpen " << DVAL(_path));
    }
    virtual void Work()
    {
        _dir = opendir(_path.c_str());
        if (_dir == NULL) SetSyscallError();
    }
    virtual void OnOK()
    {
        DBG1("FS::DirOpen::OnOK: " << DVAL(_path));
        Napi::Object res = DirWrap::constructor.New({});
        DirWrap* w = DirWrap::Unwrap(res);
        w->_path = _path;
        w->_dir = _dir;
        _deferred.Resolve(res);
        ReportWorkerStats(0);
    }
};

struct TellDir : public FSWrapWorker<DirWrap>
{
    DirOffset _tell_res = -1;
    TellDir(const Napi::CallbackInfo& info)
        : FSWrapWorker<DirWrap>(info)
    {
        Begin(XSTR() << "TellDir " << DVAL(_wrap->_path));
    }
    virtual void Work()
    {
        DIR* dir = _wrap->_dir;
        if (!dir) {
            SetError(XSTR() << "FS::TellDir::Execute: ERROR not opened " << _wrap->_path);
            return;
        }
        DBG1("FS::Telldir::Work: " << DVAL(_wrap->_path));
        _tell_res = telldir(dir);
        if (_tell_res == DirOffset(-1)) SetSyscallError();
    }
    virtual void OnOK()
    {
        DBG0("FS::Telldir::OnOK: " << DVAL(_wrap->_path) << DVAL(_tell_res));
        Napi::Env env = Env();
        auto res = Napi::BigInt::New(env, _tell_res);
        _deferred.Resolve(res);
    }
};

struct SeekDir : public FSWrapWorker<DirWrap>
{
    long int _seek_pos;
    SeekDir(const Napi::CallbackInfo& info)
        : FSWrapWorker<DirWrap>(info)
    {
        bool lossless = true;
        _seek_pos = info[1].As<Napi::BigInt>().Int64Value(&lossless);
        if (!lossless) {
            SetError("seekdir bigint value must convert lossless");
        }
        Begin(XSTR() << "SeekDir " << DVAL(_wrap->_path) << DVAL(_seek_pos));
    }
    virtual void Work()
    {
        DIR* dir = _wrap->_dir;
        if (!dir) {
            SetError(XSTR() << "FS::SeekDir::Execute: ERROR not opened " << _wrap->_path);
            return;
        }
        DBG1("FS::SeekDir::Work: " << DVAL(_wrap->_path));
        seekdir(dir, _seek_pos);
    }
};

struct DirClose : public FSWrapWorker<DirWrap>
{
    DirClose(const Napi::CallbackInfo& info)
        : FSWrapWorker<DirWrap>(info)
    {
        Begin(XSTR() << "DirClose " << DVAL(_wrap->_path));
    }
    virtual void Work()
    {
        DIR* dir = _wrap->_dir;
        std::string path = _wrap->_path;
        int r = closedir(dir);
        if (r) SetSyscallError();
        _wrap->_dir = 0;
    }
};

struct DirReadEntry : public FSWrapWorker<DirWrap>
{
    Entry _entry;
    bool _eof;
    DirReadEntry(const Napi::CallbackInfo& info)
        : FSWrapWorker<DirWrap>(info)
        , _eof(false)
    {
        Begin(XSTR() << "DirReadEntry " << DVAL(_wrap->_path));
    }
    virtual void Work()
    {
        DIR* dir = _wrap->_dir;
        std::string path = _wrap->_path;
        if (!dir) {
            SetError(XSTR() << "FS::DirReadEntry::Execute: ERROR not opened " << path);
            return;
        }
        struct dirent* e = 0;

        // loop to skip parent and current directories
        do {
            // need to set errno before the call to readdir() to detect between EOF and error
            errno = 0;
            e = readdir(dir);
        } while (e && (strcmp(e->d_name, ".") == 0 || strcmp(e->d_name, "..") == 0));
        if (e) {
            _entry.name = std::string(e->d_name);
            _entry.ino = e->d_ino;
            _entry.type = e->d_type;
            _entry.off = e->DIR_OFFSET_FIELD;
        } else {
            if (errno) {
                SetSyscallError();
            } else {
                _eof = true;
            }
        }
    }
    virtual void OnOK()
    {
        Napi::Env env = Env();
        if (_eof) {
            _deferred.Resolve(env.Null());
        } else {
            auto res = Napi::Object::New(env);
            res["name"] = Napi::String::New(env, _entry.name);
            res["ino"] = Napi::Number::New(env, _entry.ino);
            res["type"] = Napi::Number::New(env, _entry.type);
            res["off"] = Napi::BigInt::New(env, _entry.off);
            _deferred.Resolve(res);
        }
        ReportWorkerStats(0);
    }
};

Napi::Value
DirWrap::close(const Napi::CallbackInfo& info)
{
    return api<DirClose>(info);
}

Napi::Value
DirWrap::read(const Napi::CallbackInfo& info)
{
    return api<DirReadEntry>(info);
}

Napi::Value
DirWrap::telldir(const Napi::CallbackInfo& info)
{
    return api<TellDir>(info);
}

Napi::Value
DirWrap::seekdir(const Napi::CallbackInfo& info)
{
    return api<SeekDir>(info);
}

static Napi::Value
set_debug_level(const Napi::CallbackInfo& info)
{
    int level = info[0].As<Napi::Number>();
    DBG_SET_LEVEL(level);
    DBG1("FS::set_debug_level " << level);
    return info.Env().Undefined();
}

/**
 * @brief Configure global logging outputs and syslog facility.
 *
 * Sets the module-global flags that control whether logging is emitted to
 * stderr and/or to syslog, and updates the syslog debug facility name.
 *
 * @param info JavaScript callback info; expected arguments:
 *   - info[0]: boolean — enable logging to stderr.
 *   - info[1]: boolean — enable logging to syslog.
 *   - info[2]: string  — syslog debug facility name to use.
 * @return Napi::Value JavaScript `undefined`.
 */
static Napi::Value
set_log_config(const Napi::CallbackInfo& info)
{
    bool stderr_enabled = info[0].As<Napi::Boolean>();
    bool syslog_enabled = info[1].As<Napi::Boolean>();
    std::string syslog_debug_facility = info[2].As<Napi::String>();
    LOG_TO_STDERR_ENABLED = stderr_enabled;
    LOG_TO_SYSLOG_ENABLED = syslog_enabled;
    SYSLOG_DEBUG_FACILITY = syslog_debug_facility;
    DBG1("FS::set_log_config: "
        << DVAL(LOG_TO_STDERR_ENABLED)
        << DVAL(LOG_TO_SYSLOG_ENABLED)
        << DVAL(SYSLOG_DEBUG_FACILITY));
    return info.Env().Undefined();
}

/**
 * @brief Register NooBaa runtime arguments with the GPFS library.
 *
 * Extracts NooBaa registration fields ("version", "delay", "flags") from the
 * provided JavaScript parameters and calls the GPFS ganesha registration
 * entrypoint. Logs the submitted values. If the GPFS call returns
 * EOPNOTSUPP the function emits a warning and continues; any other failure
 * triggers a panic.
 */
static Napi::Value
register_gpfs_noobaa(const Napi::CallbackInfo& info)
{
    Napi::Object params = info[0].As<Napi::Object>();
    struct gpfs_ganesha_noobaa_arg args = {
        .noobaa_version = params.Get("version").ToNumber(),
        .noobaa_delay = params.Get("delay").ToNumber(),
        .noobaa_flags = params.Get("flags").ToNumber(),
    };
    LOG("FS::GPFS gpfs_ganesha_noobaa_arg=" << DVAL(args.noobaa_version) << DVAL(args.noobaa_delay) << DVAL(args.noobaa_flags));

    if (dlsym_gpfs_ganesha(OPENHANDLE_REGISTER_NOOBAA, &args)) {
        if (errno == EOPNOTSUPP) {
            LOG("Warning: register with libgpfs gpfs_ganesha returned EOPNOTSUPP");
        } else {
            PANIC("Error: register with libgpfs gpfs_ganesha failed");
        }
    }
    return info.Env().Undefined();
}

/**
 * @brief Create a POSIX-aligned buffer suitable for direct I/O.
 *
 * Allocates a memory buffer aligned to DIO_BUFFER_MEMALIGN and wraps it in a
 * Napi::Buffer for JavaScript consumption. The buffer is freed using
 * buffer_releaser when the JS Buffer is garbage-collected.
 *
 * @param info CallbackInfo where info[0] is the requested buffer size in bytes.
 * @return Napi::Value A Buffer containing the allocated, aligned memory of the requested size.
 * @throws Napi::Error If allocation fails or the requested buffer cannot be created.
 */
static Napi::Value
dio_buffer_alloc(const Napi::CallbackInfo& info)
{
    int size = info[0].As<Napi::Number>();
    uint8_t* buf = 0;
    int r = posix_memalign((void**)&buf, DIO_BUFFER_MEMALIGN, size);
    if (r || (!buf && size > 0)) {
        throw Napi::Error::New(info.Env(), "FS::dio_buffer_alloc: failed to allocate memory");
    }
    return Napi::Buffer<uint8_t>::New(info.Env(), buf, size, buffer_releaser);
}

/**
 * @brief Get the GPFS RDMA shadow buffer size for a requested buffer length.
 *
 * Expects a single numeric argument (size in bytes) at info[0]. Calls the
 * GPFS `gpfs_rdma_shadow_buffer_size` symbol to translate the requested size
 * into the required shadow buffer size for RDMA operations and returns that
 * value.
 *
 * @param info Callback info whose first element is the requested size in bytes.
 * @return int The shadow buffer size required by GPFS for the given request.
 *
 * @throws Napi::Error If the GPFS `gpfs_rdma_shadow_buffer_size` symbol is not
 *         available (error code EOPNOTSUPP) or if the underlying GPFS call
 *         returns a negative result.
 */
static Napi::Value
gpfs_rdma_shadow_buffer_size_napi(const Napi::CallbackInfo& info)
{
    if (!dlsym_gpfs_rdma_shadow_buffer_size) {
        throw napi_sys_error(info.Env(), "gpfs_rdma_shadow_buffer_size not supported", EOPNOTSUPP);
    }
    gpfs_size64_t size = napi_get_i64(info[0]);
    int r = dlsym_gpfs_rdma_shadow_buffer_size(size);
    if (r < 0) {
        throw napi_sys_error(info.Env(), "gpfs_rdma_shadow_buffer_size failed");
    }
    return Napi::Number::New(info.Env(), r);
}

/**
 * @brief Initializes filesystem bindings on the provided N-API environment and attaches them to the given exports object, including optional GPFS integration when a GPFS library path is configured.
 *
 * Exports a top-level "fs" object containing filesystem functions, constants, and a "gpfs" sub-object that indicates GPFS availability and exposes GPFS-specific helpers when the GPFS shared library is present.
 *
 * @param env The N-API environment used to create and register functions and objects.
 * @param exports The module exports object to which the "fs" namespace will be attached.
 */
void
fs_napi(Napi::Env env, Napi::Object exports)
{
    auto exports_fs = Napi::Object::New(env);
    if (gpfs_dl_path != NULL) {
        LOG("FS::GPFS GPFS_DL_PATH=" << gpfs_dl_path);
        struct stat _stat_res;
        gpfs_lib_file_exists = stat(gpfs_dl_path, &_stat_res);
        if (gpfs_lib_file_exists == -1) {
            LOG("FS::GPFS WARN couldn't find GPFS lib file GPFS_DL_PATH=" << gpfs_dl_path);
        } else {
            LOG("FS::GPFS found GPFS lib file GPFS_DL_PATH=" << gpfs_dl_path);
            uv_lib_t* lib = (uv_lib_t*)malloc(sizeof(uv_lib_t));
            // required symbols
            if (uv_dlopen(gpfs_dl_path, lib)) {
                PANIC("FS::GPFS Error: dlopen libgpfs failed " << DVAL(gpfs_dl_path) << uv_dlerror(lib));
            }
            if (uv_dlsym(lib, "gpfs_linkat", (void**)&dlsym_gpfs_linkat)) {
                PANIC("FS::GPFS Error: dlsym gpfs_linkat failed " << uv_dlerror(lib));
            }
            if (uv_dlsym(lib, "gpfs_linkatif", (void**)&dlsym_gpfs_linkatif)) {
                PANIC("FS::GPFS Error: dlsym gpfs_linkatif failed " << uv_dlerror(lib));
            }
            if (uv_dlsym(lib, "gpfs_unlinkat", (void**)&dlsym_gpfs_unlinkat)) {
                PANIC("FS::GPFS Error: dlsym gpfs_unlinkat failed " << uv_dlerror(lib));
            }
            if (uv_dlsym(lib, "gpfs_fcntl", (void**)&dlsym_gpfs_fcntl)) {
                PANIC("FS::GPFS Error: dlsym gpfs_fcntl failed " << uv_dlerror(lib));
            }
            if (uv_dlsym(lib, "gpfs_ganesha", (void**)&dlsym_gpfs_ganesha)) {
                PANIC("FS::GPFS Error: dlsym gpfs_ganesha failed " << uv_dlerror(lib));
            }
            // optional symbols
            if (uv_dlsym(lib, "gpfs_rdma_pread", (void**)&dlsym_gpfs_rdma_pread)) {
                DBG1("FS::GPFS dlsym gpfs_rdma_pread is not available " << uv_dlerror(lib));
            }
            if (uv_dlsym(lib, "gpfs_rdma_pwrite", (void**)&dlsym_gpfs_rdma_pwrite)) {
                DBG1("FS::GPFS dlsym gpfs_rdma_pwrite is not available " << uv_dlerror(lib));
            }
            if (uv_dlsym(lib, "gpfs_rdma_shadow_buffer_size", (void**)&dlsym_gpfs_rdma_shadow_buffer_size)) {
                DBG1("FS::GPFS dlsym gpfs_rdma_shadow_buffer_size is not available " << uv_dlerror(lib));
            }
            bool gpfs_rdma_enabled = (dlsym_gpfs_rdma_pread && dlsym_gpfs_rdma_pwrite);
            auto gpfs = Napi::Object::New(env);
            gpfs["register_gpfs_noobaa"] = Napi::Function::New(env, register_gpfs_noobaa);
            gpfs["rdma_enabled"] = Napi::Boolean::New(env, gpfs_rdma_enabled);
            gpfs["rdma_shadow_buffer_size"] = Napi::Function::New(env, gpfs_rdma_shadow_buffer_size_napi);
            // we export the gpfs object, which can be checked to indicate that
            // gpfs lib was loaded and its api's can be used.
            exports_fs["gpfs"] = gpfs;
        }
    } else {
        DBG1("FS::GPFS GPFS_DL_PATH=NULL, fs_napi will call default posix system calls");
    }

    exports_fs["stat"] = Napi::Function::New(env, api<Stat>);
    exports_fs["statfs"] = Napi::Function::New(env, api<Statfs>);
    exports_fs["checkAccess"] = Napi::Function::New(env, api<CheckAccess>);
    exports_fs["unlink"] = Napi::Function::New(env, api<Unlink>);
    exports_fs["unlinkat"] = Napi::Function::New(env, api<Unlinkat>);
    exports_fs["safe_unlink"] = Napi::Function::New(env, api<SafeUnlink>);
    exports_fs["rename"] = Napi::Function::New(env, api<Rename>);
    exports_fs["mkdir"] = Napi::Function::New(env, api<Mkdir>);
    exports_fs["rmdir"] = Napi::Function::New(env, api<Rmdir>);
    exports_fs["writeFile"] = Napi::Function::New(env, api<Writefile>);
    exports_fs["readFile"] = Napi::Function::New(env, api<Readfile>);
    exports_fs["readdir"] = Napi::Function::New(env, api<Readdir>);
    exports_fs["safe_link"] = Napi::Function::New(env, api<SafeLink>);
    exports_fs["link"] = Napi::Function::New(env, api<Link>);
    exports_fs["linkat"] = Napi::Function::New(env, api<Linkat>);
    exports_fs["fsync"] = Napi::Function::New(env, api<Fsync>);
    exports_fs["realpath"] = Napi::Function::New(env, api<RealPath>);
    exports_fs["getsinglexattr"] = Napi::Function::New(env, api<GetSingleXattr>);
    exports_fs["getpwname"] = Napi::Function::New(env, api<GetPwName>);
    exports_fs["symlink"] = Napi::Function::New(env, api<Symlink>);

    FileWrap::init(env);
    exports_fs["open"] = Napi::Function::New(env, api<FileOpen>);

    DirWrap::init(env);
    exports_fs["opendir"] = Napi::Function::New(env, api<DirOpen>);

    exports_fs["S_IFMT"] = Napi::Number::New(env, S_IFMT);
    exports_fs["S_IFDIR"] = Napi::Number::New(env, S_IFDIR);
    exports_fs["S_IFLNK"] = Napi::Number::New(env, S_IFLNK);
    exports_fs["DT_DIR"] = Napi::Number::New(env, DT_DIR);
    exports_fs["DT_LNK"] = Napi::Number::New(env, DT_LNK);
    exports_fs["PLATFORM_IOV_MAX"] = Napi::Number::New(env, IOV_MAX);
    ThreadScope::init_passwd_buf_size();

#ifdef O_DIRECT
    exports_fs["O_DIRECT"] = Napi::Number::New(env, O_DIRECT);
#endif
#ifdef O_TMPFILE
    exports_fs["O_TMPFILE"] = Napi::Number::New(env, O_TMPFILE);
#endif

    exports_fs["dio_buffer_alloc"] = Napi::Function::New(env, dio_buffer_alloc);
    exports_fs["set_debug_level"] = Napi::Function::New(env, set_debug_level);
    exports_fs["set_log_config"] = Napi::Function::New(env, set_log_config);

    exports["fs"] = exports_fs;
}

} // namespace noobaa