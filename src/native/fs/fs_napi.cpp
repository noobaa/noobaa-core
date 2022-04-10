/* Copyright (C) 2016 NooBaa */
#include "../util/b64.h"
#include "../util/common.h"
#include "../util/napi.h"
#include "../util/os.h"
#include "../util/buf.h"
#include "./gpfs_fcntl.h"

#include <dirent.h>
#include <fcntl.h>
#include <map>
#include <math.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/uio.h>
#include <thread>
#include <typeinfo>
#include <unistd.h>
#include <uv.h>
#include <sys/xattr.h>
#include <vector>
#include <stdlib.h>
#include <limits.h>

#ifdef __APPLE__
    #include <sys/param.h>
    #include <sys/mount.h>
#else
    #include <sys/statfs.h>
#endif

namespace noobaa
{

DBG_INIT(0);

static int (*dlsym_gpfs_fcntl)(gpfs_file_t file, void* arg) = 0;

const static std::map<std::string, int> flags_to_case = {
    { "r", O_RDONLY },
    { "rs", O_RDONLY | O_SYNC },
    { "sr", O_RDONLY | O_SYNC },
    { "r+", O_RDWR },
    { "rs+", O_RDWR | O_SYNC },
    { "sr+", O_RDWR | O_SYNC },
    { "w", O_TRUNC | O_CREAT | O_WRONLY },
    { "wx", O_TRUNC | O_CREAT | O_WRONLY | O_EXCL },
    { "xw", O_TRUNC | O_CREAT | O_WRONLY | O_EXCL },
    { "w+", O_TRUNC | O_CREAT | O_RDWR },
    { "wx+", O_TRUNC | O_CREAT | O_RDWR | O_EXCL },
    { "xw+", O_TRUNC | O_CREAT | O_RDWR | O_EXCL },
    { "a", O_APPEND | O_CREAT | O_WRONLY },
    { "ax", O_APPEND | O_CREAT | O_WRONLY | O_EXCL },
    { "xa", O_APPEND | O_CREAT | O_WRONLY | O_EXCL },
    { "as", O_APPEND | O_CREAT | O_WRONLY | O_SYNC },
    { "sa", O_APPEND | O_CREAT | O_WRONLY | O_SYNC },
    { "a+", O_APPEND | O_CREAT | O_RDWR },
    { "ax+", O_APPEND | O_CREAT | O_RDWR | O_EXCL },
    { "xa+", O_APPEND | O_CREAT | O_RDWR | O_EXCL },
    { "as+", O_APPEND | O_CREAT | O_RDWR | O_SYNC },
    { "sa+", O_APPEND | O_CREAT | O_RDWR | O_SYNC },
};

struct Entry
{
    std::string name;
    ino_t ino;
    uint8_t type;
};


template <typename T>
static Napi::Value
api(const Napi::CallbackInfo& info)
{
    auto w = new T(info);
    Napi::Promise promise = w->_deferred.Promise();
    w->Queue();
    return promise;
}

void
set_stat_res(Napi::Object res, Napi::Env env, struct stat &stat_res)
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
    #else
        double atimeMs = (double(1e3) * stat_res.st_atim.tv_sec) + (double(1e-6) * stat_res.st_atim.tv_nsec);
        double ctimeMs = (double(1e3) * stat_res.st_ctim.tv_sec) + (double(1e-6) * stat_res.st_ctim.tv_nsec);
        double mtimeMs = (double(1e3) * stat_res.st_mtim.tv_sec) + (double(1e-6) * stat_res.st_mtim.tv_nsec);
        double birthtimeMs = ctimeMs; // Posix doesn't have birthtime
    #endif

    res["atimeMs"] = Napi::Number::New(env, atimeMs);
    res["ctimeMs"] = Napi::Number::New(env, ctimeMs);
    res["mtimeMs"] = Napi::Number::New(env, mtimeMs);
    res["birthtimeMs"] = Napi::Number::New(env, birthtimeMs);
    res["atime"] = Napi::Date::New(env, uint64_t(round(atimeMs)));
    res["mtime"] = Napi::Date::New(env, uint64_t(round(mtimeMs)));
    res["ctime"] = Napi::Date::New(env, uint64_t(round(ctimeMs)));
    res["birthtime"] = Napi::Date::New(env, uint64_t(round(birthtimeMs)));

}

void
set_statfs_res(Napi::Object res, Napi::Env env, struct statfs &statfs_res)
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
    int _errno;
    int _warn_threshold_ms;

    FSWorker(const Napi::CallbackInfo& info)
        : AsyncWorker(info.Env())
        , _deferred(Napi::Promise::Deferred::New(info.Env()))
        , _args_ref(Napi::Persistent(Napi::Object::New(info.Env())))
        , _tid(0)
        , _uid(ThreadScope::orig_uid)
        , _gid(ThreadScope::orig_gid)
        , _errno(0)
        , _warn_threshold_ms(0)
    {
        for (int i = 0; i < (int)info.Length(); ++i) _args_ref.Set(i, info[i]);
        Napi::Object config = info[0].As<Napi::Object>();
        if (config.Has("uid")) _uid = config.Get("uid").ToNumber();
        if (config.Has("gid")) _gid = config.Get("gid").ToNumber();
        if (config.Has("backend")) _backend = config.Get("backend").ToString();
        if (config.Has("warn_threshold_ms")) _warn_threshold_ms = config.Get("warn_threshold_ms").ToNumber();
    }
    void Begin(std::string desc)
    {
        _desc = desc;
        DBG1("FS::FSWorker::Begin: " << _desc);
    }
    virtual void Work() = 0;
    void Execute() override
    {
        DBG1("FS::FSWorker::Execute: " << _desc << DVAL(_uid) << DVAL(_gid) << DVAL(_backend));
        ThreadScope tx;
        tx.set_user(_uid, _gid);
        auto start_time = std::chrono::high_resolution_clock::now();
        Work();
        auto end_time = std::chrono::high_resolution_clock::now();
        double took_time = std::chrono::duration<double, std::milli>(end_time - start_time).count();
        if (_warn_threshold_ms && took_time > _warn_threshold_ms) {
            DBG0("FS::FSWorker::Execute: WARNING " << _desc << " took too long: " << took_time << " ms");
        } else {
            DBG1("FS::FSWorker::Execute: " << _desc << " took: " << took_time << " ms");
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
    virtual void OnOK() override
    {
        DBG1("FS::FSWorker::OnOK: undefined " << _desc);
        _deferred.Resolve(Env().Undefined());
    }
    virtual void OnError(Napi::Error const& error) override
    {
        Napi::Env env = Env();
        DBG1("FS::FSWorker::OnError: " << _desc << " " << DVAL(error.Message()));
        auto obj = error.Value();
        if (_errno) {
            obj.Set("code", Napi::String::New(env, uv_err_name(uv_translate_sys_error(_errno))));
        }
        _deferred.Reject(obj);
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
 */
struct Stat : public FSWorker
{
    std::string _path;
    struct stat _stat_res;

    Stat(const Napi::CallbackInfo& info)
        : FSWorker(info)
    {
        _path = info[1].As<Napi::String>();
        Begin(XSTR() << "Stat " << DVAL(_path));
    }
    virtual void Work()
    {
        int r = stat(_path.c_str(), &_stat_res);
        if (r) SetSyscallError();
    }
    virtual void OnOK()
    {
        DBG1("FS::Stat::OnOK: " << DVAL(_path) << DVAL(_stat_res.st_ino) << DVAL(_stat_res.st_size));    
        Napi::Env env = Env();
        auto res = Napi::Object::New(env);
        set_stat_res(res, env, _stat_res);

        _deferred.Resolve(res);
    }
};

/**
 * LStat is an fs op
 */
struct LStat : public FSWorker
{
    std::string _path;
    struct stat _stat_res;

    LStat(const Napi::CallbackInfo& info)
        : FSWorker(info)
    {
        _path = info[1].As<Napi::String>();
        Begin(XSTR() << "LStat " << DVAL(_path));
    }
    virtual void Work()
    {
        int r = lstat(_path.c_str(), &_stat_res);
        if (r) SetSyscallError();
    }
    virtual void OnOK()
    {
        DBG1("FS::LStat::OnOK: " << DVAL(_path) << DVAL(_stat_res.st_ino) << DVAL(_stat_res.st_size));
        Napi::Env env = Env();
        auto res = Napi::Object::New(env);
        set_stat_res(res, env, _stat_res);
        
        _deferred.Resolve(res);
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
        int r = statfs(_path.c_str(), &_statfs_res);
        if (r) SetSyscallError();
    }
    virtual void OnOK()
    {
        DBG1("FS::Statfs::OnOK: " << DVAL(_path) << DVAL(_statfs_res.f_type) << DVAL(_statfs_res.f_bsize));
        Napi::Env env = Env();
        auto res = Napi::Object::New(env);
        set_statfs_res(res, env, _statfs_res);

        _deferred.Resolve(res);
    }
};


/**
 * CheckAccess is an fs op
 */
struct CheckAccess : public FSWorker
{
    std::string _path;
    struct stat _stat_res;

    CheckAccess(const Napi::CallbackInfo& info)
        : FSWorker(info)
    {
        _path = info[1].As<Napi::String>();
        Begin(XSTR() << "CheckAccess " << DVAL(_path));
    }
    virtual void Work()
    {
        int fd = open(_path.c_str(), O_RDONLY);
        if (fd < 0) {
            SetSyscallError();
            return;
        }
        int r = close(fd);
        if (r) SetSyscallError();
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
        int r = unlink(_path.c_str());
        if (r == -1) SetSyscallError();
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
        Begin(XSTR() << DVAL(_path) << DVAL(_dirfd) << DVAL(_flags));
    }
    virtual void Work()
    {
        int r = unlinkat(_dirfd, _path.c_str(), _flags);
        if (r == -1) SetSyscallError();
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
        Begin(XSTR() << DVAL(_oldpath) << DVAL(_newpath));
    }
    virtual void Work()
    {
        int r = link(_oldpath.c_str(), _newpath.c_str());
        if (r == -1) SetSyscallError();
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
        Begin(XSTR() << DVAL(_oldpath) << DVAL(_olddirfd) << DVAL(_newpath) << DVAL(_newdirfd) << DVAL(_flags));
    }
    virtual void Work()
    {
        int r = linkat(_olddirfd, _oldpath.c_str(), _newdirfd, _newpath.c_str(), _flags);
        if (r == -1) SetSyscallError();
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
        int r = mkdir(_path.c_str(), _mode);
        if (r == -1) SetSyscallError();
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
        int r = rmdir(_path.c_str());
        if (r == -1) SetSyscallError();
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
        int r = rename(_old_path.c_str(), _new_path.c_str());
        if (r == -1) SetSyscallError();
    }
};

/**
 * Writefile is an fs op
 */
struct Writefile : public FSWorker
{
    std::string _path;
    const uint8_t* _data;
    size_t _len;
    mode_t _mode;
    Writefile(const Napi::CallbackInfo& info)
        : FSWorker(info)
        , _mode(0666)
    {
        _path = info[1].As<Napi::String>();
        auto buf = info[2].As<Napi::Buffer<uint8_t>>();
        _data = buf.Data();
        _len = buf.Length();
        if (info.Length() > 3 && !info[3].IsUndefined()) {
            _mode = info[3].As<Napi::Number>().Uint32Value();
        }
        Begin(XSTR() << "Writefile " << DVAL(_path) << DVAL(_len) << DVAL(_mode));
    }
    virtual void Work()
    {
        int fd = open(_path.c_str(), O_TRUNC | O_CREAT | O_WRONLY, _mode);
        if (fd < 0) {
            SetSyscallError();
            return;
        }

        ssize_t len = write(fd, _data, _len);
        if (len < 0) {
            SetSyscallError();
        } else if ((size_t)len != _len) {
            SetError(XSTR() << "Writefile: partial write error " << DVAL(len) << DVAL(_len));
        }

        int r = close(fd);
        if (r) SetSyscallError();
    }
};

/**
 * Readfile is an fs op
 */
struct Readfile : public FSWorker
{
    std::string _path;
    uint8_t* _data;
    int _len;
    Readfile(const Napi::CallbackInfo& info)
        : FSWorker(info)
        , _data(0)
        , _len(0)
    {
        _path = info[1].As<Napi::String>();
        Begin(XSTR() << "Readfile " << DVAL(_path));
    }
    virtual ~Readfile()
    {
        if (_data) {
            delete[] _data;
            _data = 0;
        }
    }
    virtual void Work()
    {
        int fd = open(_path.c_str(), O_RDONLY);
        if (fd < 0) {
            SetSyscallError();
            return;
        }

        struct stat stat_res;
        int r = fstat(fd, &stat_res);
        if (r) {
            SetSyscallError();
            r = close(fd);
            if (r) SetSyscallError(); // Report only
            return;
        }

        _len = stat_res.st_size;
        _data = new uint8_t[_len];

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

        r = close(fd);
        if (r) SetSyscallError();
    }
    virtual void OnOK()
    {
        DBG1("FS::FSWorker::OnOK: Readfile " << DVAL(_path));
        auto buf = Napi::Buffer<uint8_t>::Copy(Env(), _data, _len);
        _deferred.Resolve(buf);
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
                });
            } else {
                if (errno) SetSyscallError();
                break;
            }
        }

        int r = closedir(dir);
        if (r) SetSyscallError();
    }
    virtual void OnOK()
    {
        DBG1("FS::FSWorker::OnOK: Readdir " << DVAL(_path));
        Napi::Env env = Env();
        Napi::Array res = Napi::Array::New(env, _entries.size());
        int index = 0;
        // if (_withFileTypes) {
        for (auto it = _entries.begin(); it != _entries.end(); ++it) {
            auto dir_rec = Napi::Object::New(env);
            dir_rec["name"] = Napi::String::New(env, it->name);
            dir_rec["ino"] = Napi::Number::New(env, it->ino);
            dir_rec["type"] = Napi::Number::New(env, it->type);
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
        if (fd < 0) {
            SetSyscallError();
            return;
        }

        int rs = fsync(fd);
        if (rs) {
            SetSyscallError();
            return;
        }

        int rc = close(fd);
        if (rc) SetSyscallError();
    }
};


struct FileWrap : public Napi::ObjectWrap<FileWrap>
{
    std::string _path;
    int _fd;
    static Napi::FunctionReference constructor;
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
                InstanceMethod<&FileWrap::setxattr>("setxattr"),
                InstanceMethod<&FileWrap::getxattr>("getxattr"),
                InstanceMethod<&FileWrap::stat>("stat"),
                InstanceMethod<&FileWrap::fsync>("fsync"),
            }));
        constructor.SuppressDestruct();
    }
    FileWrap(const Napi::CallbackInfo& info)
        : Napi::ObjectWrap<FileWrap>(info)
        , _fd(0)
    {
    }
    ~FileWrap()
    {
        if (_fd) {
            LOG("FS::FileWrap::dtor: file not closed " << DVAL(_path) << DVAL(_fd));
            int r = ::close(_fd);
            if (r) LOG("FS::FileWrap::dtor: file close failed " << DVAL(_path) << DVAL(_fd) << DVAL(r));
            _fd = 0;
        }
    }
    Napi::Value close(const Napi::CallbackInfo& info);
    Napi::Value read(const Napi::CallbackInfo& info);
    Napi::Value write(const Napi::CallbackInfo& info);
    Napi::Value writev(const Napi::CallbackInfo& info);
    Napi::Value setxattr(const Napi::CallbackInfo& info);
    Napi::Value getxattr(const Napi::CallbackInfo& info);
    Napi::Value stat(const Napi::CallbackInfo& info);
    Napi::Value fsync(const Napi::CallbackInfo& info);
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
        , _fd(0)
        , _flags(0)
        , _mode(0666)
    {
        _path = info[1].As<Napi::String>();
        if (info.Length() > 2 && !info[2].IsUndefined()) {
            _flags = flags_to_case.at(info[2].As<Napi::String>());
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
        std::string path = _wrap->_path;
        int r = close(fd);
        if (r) SetSyscallError();
        _wrap->_fd = 0;
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
    virtual void Work()
    {
        int fd = _wrap->_fd;
        std::string path = _wrap->_path;
        if (fd < 0) {
            SetError(XSTR() << "FS::FileRead::Execute: ERROR not opened " << path);
            return;
        }
        _br = pread(fd, _buf + _offset, _len, _pos);
        if (_br < 0) {
            SetSyscallError();
            return;
        }
    }
    virtual void OnOK()
    {
        DBG1("FS::FSWorker::OnOK: FileRead " << DVAL(_wrap->_path));
        Napi::Env env = Env();
        _deferred.Resolve(Napi::Number::New(env, _br));
    }
};

struct FileWrite : public FSWrapWorker<FileWrap>
{
    const uint8_t* _buf;
    size_t _len;
    FileWrite(const Napi::CallbackInfo& info)
        : FSWrapWorker<FileWrap>(info)
        , _buf(0)
        , _len(0)
    {
        auto buf = info[1].As<Napi::Buffer<uint8_t>>();
        _buf = buf.Data();
        _len = buf.Length();
        Begin(XSTR() << "FileWrite " << DVAL(_wrap->_path) << DVAL(_len));
    }
    virtual void Work()
    {
        int fd = _wrap->_fd;
        std::string path = _wrap->_path;
        if (fd < 0) {
            SetError(XSTR() << "FS::FileWrite::Execute: ERROR not opened " << path);
            return;
        }
        // TODO: Switch to pwrite when needed
        ssize_t bw = write(fd, _buf, _len);
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
    FileWritev(const Napi::CallbackInfo& info)
        : FSWrapWorker<FileWrap>(info)
        , _total_len(0)
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
        Begin(XSTR() << "FileWritev " << DVAL(_wrap->_path) << DVAL(_total_len) << DVAL(buffers_len));
    }
    virtual void Work()
    {
        int fd = _wrap->_fd;
        std::string path = _wrap->_path;
        if (fd < 0) {
            SetError(XSTR() << "FS::FileWritev::Execute: ERROR not opened " << path);
            return;
        }
        ssize_t bw = writev(fd, iov_vec.data(), iov_vec.size());
        if (bw < 0) {
            SetSyscallError();
        } else if (bw != _total_len) {
            // TODO: Handle partial writes as well and not fail the operation
            SetError(XSTR() << "FS::FileWritev::Execute: partial writev error " << DVAL(bw) << DVAL(_total_len));
        }
    }
};

/**
 * TODO: Not atomic and might cause partial updates of MD
 */
struct FileSetxattr : public FSWrapWorker<FileWrap>
{
    std::map<std::string, std::string> _md;
    FileSetxattr(const Napi::CallbackInfo& info)
        : FSWrapWorker<FileWrap>(info)
    {
        auto md = info[1].As<Napi::Object>();
        auto keys = md.GetPropertyNames();
        for (uint32_t i = 0; i < keys.Length(); ++i) {
            auto key = keys.Get(i).ToString().Utf8Value();
            auto value = md.Get(key).ToString().Utf8Value();
            _md[key] = value;
        }
        Begin(XSTR() << "FileSetxattr " << DVAL(_wrap->_path));
    }
    virtual void Work()
    {
        int fd = _wrap->_fd;
        for (auto it = _md.begin(); it != _md.end(); ++it) {
            #ifdef __APPLE__
                auto r = fsetxattr(fd, it->first.c_str(), it->second.c_str(), it->second.length(), 0, 0);
            #else
                auto r = fsetxattr(fd, it->first.c_str(), it->second.c_str(), it->second.length(), 0);
            #endif
            if (r == -1) {
                SetSyscallError();
                return;
            }
        }
    }
};

struct FileGetxattr : public FSWrapWorker<FileWrap>
{
    std::map<std::string, std::string> _md;
    FileGetxattr(const Napi::CallbackInfo& info)
        : FSWrapWorker<FileWrap>(info)
    {
        Begin(XSTR() << "FileGetxattr " << DVAL(_wrap->_path));
    }
    virtual void Work()
    {
        int fd = _wrap->_fd;
        // Serves as a "lock" mechanism when reading the xattrs of a file
        // Since this is non atomic operation, we abort if ctime of file changed
        struct stat stat_res;
        auto r = fstat(fd, &stat_res);
        if (r) {
            SetSyscallError();
            return;
        }
        auto start_ctime = stat_res.st_ctime;

        #ifdef __APPLE__
            ssize_t buf_len = flistxattr(fd, NULL, 0, 0);
        #else
            ssize_t buf_len = flistxattr(fd, NULL, 0);
        #endif

        // No xattr, nothing to do  
        if (buf_len == 0) return;

        if (buf_len == -1) {
            SetSyscallError();
            return;
        }

        Buf buf(buf_len);

        #ifdef __APPLE__
            buf_len = flistxattr(fd, buf.cdata(), buf_len, 0);
        #else
            buf_len = flistxattr(fd, buf.cdata(), buf_len);
        #endif

        if (buf_len == -1) {
            SetSyscallError();
            return;
        }

        while (buf.length()) {
            std::string key(buf.cdata());

            #ifdef __APPLE__
                ssize_t value_len = fgetxattr(fd, key.c_str(), NULL, 0, 0, 0);
            #else
                ssize_t value_len = fgetxattr(fd, key.c_str(), NULL, 0);
            #endif

            if (value_len == -1) {
                SetSyscallError();
                return;
            }

            if (value_len > 0) {
                Buf val(value_len);

                #ifdef __APPLE__
                    value_len = fgetxattr(fd, key.c_str(), val.cdata(), value_len, 0, 0);
                #else
                    value_len = fgetxattr(fd, key.c_str(), val.cdata(), value_len);
                #endif

                if (value_len == -1) {
                    SetSyscallError();
                    return;
                }
                
                _md[key] = std::string(val.cdata(), value_len);
            } else if (value_len == 0) {
                _md[key] = "";
            }

            buf.slice(key.size() + 1, buf.length());
        }

        r = fstat(fd, &stat_res);
        if (r) {
            SetSyscallError();
            return;
        }
        auto end_ctime = stat_res.st_ctime;
        if (start_ctime != end_ctime) {
            // Cancel on ctime change due to non atomic nature of this call
            SetError(XSTR() << "FileGetxattr: " << DVAL(_wrap->_path) << " cancelled due to ctime change");
        }
    }
    virtual void OnOK()
    {
        DBG1("FS::FSWorker::OnOK: FileGetxattr " << DVAL(_wrap->_path));
        Napi::Env env = Env();
        Napi::Object res = Napi::Object::New(env);
        for (auto it = _md.begin(); it != _md.end(); ++it) {
            res.Set(it->first, it->second);
        }
        _deferred.Resolve(res);
    }
};

struct FileStat : public FSWrapWorker<FileWrap>
{
    struct stat _stat_res;

    FileStat(const Napi::CallbackInfo& info)
        : FSWrapWorker<FileWrap>(info)
    {
        Begin(XSTR() << "FileStat " << DVAL(_wrap->_path));
    }
    virtual void Work()
    {
        int fd = _wrap->_fd;
        std::string path = _wrap->_path;
        if (fd < 0) {
            SetError(XSTR() << "FS::FileStat::Execute: ERROR not opened " << path);
            return;
        }
        int r = fstat(fd, &_stat_res);
        if (r) SetSyscallError();
    }
    virtual void OnOK()
    {
        DBG1("FS::FileStat::OnOK: FileStat " << DVAL(_stat_res.st_ino) << DVAL(_stat_res.st_size));
        Napi::Env env = Env();
        auto res = Napi::Object::New(env);
        set_stat_res(res, env, _stat_res);
        
        _deferred.Resolve(res);
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
        std::string path = _wrap->_path;
        if (fd < 0) {
            SetError(XSTR() << "FS::FileFsync::Execute: ERROR not opened " << path);
            return;
        }
        int r = fsync(fd);
        if (r) SetSyscallError();
    }
};

struct RealPath : public FSWorker
{
    std::string _path;
    char* _full_path;

    RealPath(const Napi::CallbackInfo& info)
        : FSWorker(info)
    {
        _path = info[1].As<Napi::String>();
        Begin(XSTR() << DVAL(_path));
    }

    virtual void Work()
    {
        _full_path = realpath(_path.c_str(), NULL);
        if (_full_path == NULL) SetSyscallError();
    }

    virtual void OnOK()
    {
        DBG1("FS::RealPath::OnOK: " << DVAL(_path) << DVAL(_full_path));
        
        Napi::Env env = Env();
        auto res = Napi::String::New(env, _full_path);
        _deferred.Resolve(res);
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

Napi::Value
FileWrap::writev(const Napi::CallbackInfo& info)
{
    return api<FileWritev>(info);
}

Napi::Value
FileWrap::setxattr(const Napi::CallbackInfo& info)
{
    return api<FileSetxattr>(info);
}

Napi::Value
FileWrap::getxattr(const Napi::CallbackInfo& info)
{
    return api<FileGetxattr>(info);
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
            _deferred.Resolve(res);
        }
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
set_debug_level(const Napi::CallbackInfo& info)
{
    int level = info[0].As<Napi::Number>();
    LOG("FS::set_debug_level " << level);
    DBG_SET_LEVEL(level);
    return info.Env().Undefined();
}

void
fs_napi(Napi::Env env, Napi::Object exports)
{
    auto exports_fs = Napi::Object::New(env);

    const char* env_p = std::getenv("GPFS_DL_PATH");
    if (env_p != NULL) {
        LOG("FS::GPFS GPFS_DL_PATH=" << env_p);
        uv_lib_t *lib = (uv_lib_t*) malloc(sizeof(uv_lib_t));
        if (uv_dlopen(env_p, lib)) {
            PANIC("Error: %s\n" << uv_dlerror(lib));
        }
        if (uv_dlsym(lib, "gpfs_fcntl", (void **) &dlsym_gpfs_fcntl)) {
            PANIC("Error: %s\n" << uv_dlerror(lib));
        }
    }

    exports_fs["stat"] = Napi::Function::New(env, api<Stat>);
    exports_fs["lstat"] = Napi::Function::New(env, api<LStat>);
    exports_fs["statfs"] = Napi::Function::New(env, api<Statfs>);
    exports_fs["checkAccess"] = Napi::Function::New(env, api<CheckAccess>);
    exports_fs["unlink"] = Napi::Function::New(env, api<Unlink>);
    exports_fs["unlinkat"] = Napi::Function::New(env, api<Unlinkat>);
    exports_fs["rename"] = Napi::Function::New(env, api<Rename>);
    exports_fs["mkdir"] = Napi::Function::New(env, api<Mkdir>);
    exports_fs["rmdir"] = Napi::Function::New(env, api<Rmdir>);
    exports_fs["writeFile"] = Napi::Function::New(env, api<Writefile>);
    exports_fs["readFile"] = Napi::Function::New(env, api<Readfile>);
    exports_fs["readdir"] = Napi::Function::New(env, api<Readdir>);
    exports_fs["link"] = Napi::Function::New(env, api<Link>);
    exports_fs["linkat"] = Napi::Function::New(env, api<Linkat>);
    exports_fs["fsync"] = Napi::Function::New(env, api<Fsync>);
    exports_fs["realpath"] = Napi::Function::New(env, api<RealPath>);

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

    exports_fs["set_debug_level"] = Napi::Function::New(env, set_debug_level);

    exports["fs"] = exports_fs;
}

} // namespace noobaa
