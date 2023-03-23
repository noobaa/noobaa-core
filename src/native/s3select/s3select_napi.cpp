/* Copyright (C) 2016 NooBaa */

#include "../../../src/native/third_party/isa-l/include/crc.h"
#include "../../../submodules/s3select/include/s3select.h"
#include "../util/common.h"
#include "../util/napi.h"
#include <arpa/inet.h>
#include <condition_variable>

namespace noobaa
{

const char *CSV_FORMAT = "CSV";
const char *JSON_FORMAT = "JSON";
const char *PARQUET_FORMAT = "Parquet";

class S3SelectNapi;

class SelectWorker : public Napi::AsyncWorker
{
public:
    Napi::ObjectReference _args_ref;
    Napi::Promise::Deferred _deferred;
    Napi::ObjectWrap<S3SelectNapi>& _wrap;
    s3selectEngine::csv_object *_csv_object;
    s3selectEngine::json_object *_json_object;
#ifdef _ARROW_EXIST
    s3selectEngine::parquet_object *_parquet_object;
#endif
    std::string _select;
    const char* _buffer;
    const unsigned int _buffer_len;
    const bool _is_flush;
    const std::string _input_format;
    const uint8_t* _headers_bytes;
    const uint32_t _headers_len;
#ifdef _ARROW_EXIST
    Napi::ThreadSafeFunction &_parquet_page;
    Napi::ObjectReference &_s3select_js_ref;
    uint32_t *_parquet_read_bytes;
    std::mutex _mutex;
    std::condition_variable _cond;
#endif

    SelectWorker(const Napi::CallbackInfo& info,
        Napi::ObjectWrap<S3SelectNapi>& wrap,
        s3selectEngine::csv_object* csv_object,
        s3selectEngine::json_object* json_object,
#ifdef _ARROW_EXIST
        s3selectEngine::parquet_object * parquet_object,
#endif
        const char* buffer,
        const unsigned int buffer_len,
        const bool is_flush,
        const std::string input_format,
        const uint8_t* headers_bytes,
        const uint32_t headers_len
#ifdef _ARROW_EXIST
        ,Napi::ThreadSafeFunction &parquet_page,
        Napi::ObjectReference &s3select_js_ref,
        uint32_t *parquet_read_bytes
#endif
        )
        : AsyncWorker(info.Env())
        , _args_ref(Napi::Persistent(Napi::Object::New(info.Env())))
        , _wrap(wrap)
        , _csv_object(csv_object)
        , _json_object(json_object)
#ifdef _ARROW_EXIST
        , _parquet_object(parquet_object)
#endif
        , _buffer(buffer)
        , _buffer_len(buffer_len)
        , _is_flush(is_flush)
        , _input_format(input_format)
        , _deferred(info.Env())
        , _headers_bytes(headers_bytes)
        , _headers_len(headers_len)
#ifdef _ARROW_EXIST
        , _parquet_page(parquet_page)
        , _s3select_js_ref(s3select_js_ref)
        , _parquet_read_bytes(parquet_read_bytes)
#endif
    {
        //take a ref on args to make sure they are not GCed until worker is done
        uint32_t i;
        for (i = 0; i < info.Length(); ++i) {
            _args_ref.Set(i, info[i]);
        }
        //prevent GC of S3SelectNapi object by JS until worker is done
        _wrap.Ref();
    }

    ~SelectWorker()
    {
        //Worker is done, unref the ref we took in ctor
        _wrap.Unref();
    }

    Napi::Object handle_result_str(Napi::Env env, std::string &result_str){
        Napi::Object result_js = Napi::Object::New(env);
        Napi::Value select_buf = Napi::Buffer<char>::/*New*/ Copy(env, result_str.data(), result_str.length());
        result_js.Set("select", select_buf);

        uint32_t prelude[3];
        int32_t prelude_crc, message_crc, prelude_crc_BE;
        prelude[0] = htonl(_select.length() + _headers_len + 16);
        prelude[1] = htonl(_headers_len);
        prelude_crc = crc32_gzip_refl_base(0, (uint8_t*)prelude, 8);
        result_js.Set("prelude_crc", prelude_crc);
        prelude_crc_BE = htonl(prelude_crc);
        /*std::cout << "sz = " << sizeof(headers_bytes) << ", native prelude_crc = " << prelude_crc << ", prelude = " << std::hex << std::setfill('0') << std::setw(2) << prelude[0] << prelude[1];
        std::cout << std::endl;
        std::cout.flush();*/
        message_crc = crc32_gzip_refl_base(prelude_crc, (uint8_t*)&prelude_crc_BE, 4);
        message_crc = crc32_gzip_refl_base(message_crc, const_cast<uint8_t*>(_headers_bytes), _headers_len);
        message_crc = crc32_gzip_refl_base(message_crc, (uint8_t*)_select.data(), _select.length());
        result_js.Set("message_crc", message_crc);

        return result_js;
    }

#ifdef _ARROW_EXIST
    Napi::Value s3select_parquet_page_js_unlock_cb(const Napi::CallbackInfo &info)
    {
        _mutex.lock();
        _cond.notify_one();
        _mutex.unlock();

        return info.Env().Null();
    }

    //call back into node to send the page down the pipe.
    void s3select_parquet_page_js(Napi::Env env, Napi::Function handle_result, std::string *page)
    {
        Napi::Object result = handle_result_str(env, *page);
        //tell the node object how many bytes we've read (for stats)
        result.Set("parquet_read_bytes", Napi::Number::New(env, *_parquet_read_bytes));
        *_parquet_read_bytes = 0;

        napi_value s3select_js = _s3select_js_ref.Value();
        Napi::Value res = handle_result.Call(s3select_js, {result});

        //handle_result is an async node function
        //it might, but not necessarily, return a promise
        if (res.IsPromise()) {
            Napi::Promise promise = res.As<Napi::Promise>();
            Napi::Function then = promise.Get("then").As<Napi::Function>();
            auto fp_s3select_parquet_page_js_unlock_cb =
                std::bind(&SelectWorker::s3select_parquet_page_js_unlock_cb, this, std::placeholders::_1);
            Napi::Function callback = Napi::Function::New(env, fp_s3select_parquet_page_js_unlock_cb, "unlock_cb");
            then.Call(promise, {callback});
        } else {
            //sync (ie, no promise) return
            _mutex.lock();
            _cond.notify_one();
            _mutex.unlock();
        }
    }

    int s3select_parquet_page_cb(std::string& page)
    {
        //std::cout << "format res size in result_format = " << page.length() << std::endl;
        std::function<void(Napi::Env, Napi::Function, std::string*)> fp_select_parquet_page_js = std::bind(
            &SelectWorker::s3select_parquet_page_js,
            this,
            std::placeholders::_1,
            std::placeholders::_2,
            std::placeholders::_3);
        _parquet_page.Acquire();
        std::unique_lock ul(_mutex);
        napi_status ns = _parquet_page.BlockingCall(&page, fp_select_parquet_page_js);

        //wait until node is done with result.
        _cond.wait(ul);
        ul.unlock();

        _parquet_page.Release();
        page.clear();
        return 0;
    }
#endif

    void Execute() override
    {
        int rc;
        // TODO - if we get total size on beginning, i think we can remove the is_flush if
        if (CSV_FORMAT == _input_format) {
            if (_is_flush) {
                rc = _csv_object->run_s3select_on_stream(_select, nullptr, 0, 0);
            } else {
                rc = _csv_object->run_s3select_on_stream(_select, _buffer, _buffer_len, SIZE_MAX);
            }
        } else if (JSON_FORMAT == _input_format) {
            if (_is_flush) {
                rc = _json_object->run_s3select_on_stream(_select, nullptr, 0, 0);
            } else {
                rc = _json_object->run_s3select_on_stream(_select, _buffer, _buffer_len, SIZE_MAX);
            }
#ifdef _ARROW_EXIST
        } else {
            std::function<int(std::string&)> fp_s3select_header_format = [](std::string& result){return 0;};
            std::function<int(std::string&)> fp_s3select_result_format = std::bind(&SelectWorker::s3select_parquet_page_cb, this, std::placeholders::_1);
            try {
                rc = _parquet_object->run_s3select_on_object(_select, fp_s3select_result_format, fp_s3select_header_format);
            }
            catch(s3selectEngine::base_s3select_exception const &ex){
                rc = -2; //this will cause us to go into SetError
            }
#endif
        }
        if (rc < 0) {
            if (CSV_FORMAT == _input_format) {
                SetError(_csv_object->get_error_description());
            } else if (JSON_FORMAT == _input_format) {
                // SetError(json_object.get_error_description()); //TODO - they added a getter, use after submodule is updated
                SetError("failed to select from json");
#ifdef _ARROW_EXIST
            } else {
                if( rc != -1 ) { //-1 indicates EOF
                    SetError(_parquet_object->get_error_description());    
                }
#endif
            }
        }
        //std::cout << "select rc " << rc << ", str = " << this->_select << std::endl;
    }

    void OnOK() override
    {   
        Napi::Env env = Env();
        // in case of empty select result (ie, no rows in current buffer matched sql condition), return null
        if (_select.empty()) {
            _deferred.Resolve(env.Null());
            return;
        }

        Napi::Object result = handle_result_str(env, _select);

        _deferred.Resolve(result);

    }

    void OnError(Napi::Error const& error) override
    {
        Napi::Env env = Env();
        auto obj = error.Value();
        _deferred.Reject(obj);
    }
};

class S3SelectNapi : public Napi::ObjectWrap<S3SelectNapi>
{

public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    S3SelectNapi(const Napi::CallbackInfo& info);
    Napi::Value Write(const Napi::CallbackInfo& info);
    Napi::Value Flush(const Napi::CallbackInfo& info);
#ifdef _ARROW_EXIST
    Napi::Value SelectParquet(const Napi::CallbackInfo &info);
    void Finalize(Napi::Env env) override;
#endif
    ~S3SelectNapi();

private:
    static Napi::FunctionReference constructor;
    Napi::ObjectReference _args_ref;
    std::string input_format;
    s3selectEngine::s3select s3select;
    s3selectEngine::csv_object *csv_object = nullptr;
    s3selectEngine::json_object *json_object = nullptr;
#ifdef _ARROW_EXIST
    s3selectEngine::parquet_object *parquet_object = nullptr;
    s3selectEngine::rgw_s3select_api s3select_api;
    uint32_t parquet_size_bytes, parquet_read_bytes = 0;
    std::string parquet_file_path;
    uid_t uid;
    gid_t gid;
    Napi::ThreadSafeFunction parquet_page;
    Napi::ObjectReference s3select_js_ref;
    FILE *parquet_file = nullptr;
#endif
    const uint8_t* headers_buf;
    uint32_t headers_len;
};

Napi::Value
S3SelectNapi::Write(const Napi::CallbackInfo& info)
{
    Napi::Buffer<char> buffer = info[0].As<Napi::Buffer<char>>();
    SelectWorker *worker = new SelectWorker(
        info,
        *this,
        csv_object,
        json_object,
#ifdef _ARROW_EXIST
        parquet_object,
#endif
        buffer.Data(),
        buffer.Length(),
        false,
        input_format,
        headers_buf,
        headers_len
#ifdef _ARROW_EXIST
        ,parquet_page,
        s3select_js_ref,
        &parquet_read_bytes
#endif
        );
    worker->Queue();
    return worker->_deferred.Promise();
}

Napi::Value
S3SelectNapi::Flush(const Napi::CallbackInfo& info)
{
    SelectWorker *worker = new SelectWorker(
        info,
        *this,
        csv_object,
        json_object,
#ifdef _ARROW_EXIST
        parquet_object,
#endif
        nullptr, /*No buffer for flush*/
        0,
        true, //is_flush
        input_format,
        headers_buf,
        headers_len
#ifdef _ARROW_EXIST
        ,parquet_page,
        s3select_js_ref,
        nullptr
#endif
        );
    worker->Queue();
    return worker->_deferred.Promise();
}

#ifdef _ARROW_EXIST
Napi::Value
S3SelectNapi::SelectParquet(const Napi::CallbackInfo& info)
{
    SelectWorker *worker = new SelectWorker(
        info,
        *this,
        nullptr, //csv object
        nullptr, //json object
        parquet_object,
        nullptr, //no buffer parquet
        0, //buffer len
        false, //is_flush
        PARQUET_FORMAT, //format
        headers_buf,
        headers_len,
        parquet_page,
        s3select_js_ref,
        &parquet_read_bytes);
    worker->Queue();
    return worker->_deferred.Promise();
}
#endif

Napi::FunctionReference S3SelectNapi::constructor;

Napi::Object
S3SelectNapi::Init(Napi::Env env, Napi::Object exports)
{
    Napi::HandleScope scope(env);

    Napi::Function func = DefineClass(
        env,
        "S3SelectNapi",
        {
            InstanceMethod("write", &S3SelectNapi::Write),
            InstanceMethod("flush", &S3SelectNapi::Flush),
#ifdef _ARROW_EXIST
            InstanceMethod("select_parquet",  &S3SelectNapi::SelectParquet)
#endif
        }
    ); //end of DefineClass

    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();

    exports.Set("S3Select", func);
#ifdef _ARROW_EXIST
    exports.Set("select_parquet", Napi::Boolean::New(env, true));
#else
    exports.Set("select_parquet", Napi::Boolean::New(env, false));
#endif
    return exports;
}

#ifdef _ARROW_EXIST
void S3SelectNapi::Finalize(Napi::Env env)
{
    if (PARQUET_FORMAT == input_format) {
        s3select_js_ref.Unref();
    }
}
#endif

void
s3select_napi(Napi::Env env, Napi::Object exports)
{
    S3SelectNapi::Init(env, exports);
}

std::string
GetStringWithDefault(Napi::Object obj, std::string name, std::string dfault)
{
    if (obj.Has(name)) {
        return obj.Get(name).ToString().Utf8Value();
    }
    return dfault;
}

S3SelectNapi::S3SelectNapi(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<S3SelectNapi>(info)
    , _args_ref(Napi::Persistent(Napi::Object::New(info.Env())))
{
    Napi::Env env = info.Env();
    Napi::Object context = info[0].As<Napi::Object>();
    _args_ref.Set("context", context);
    Napi::Object input_serialization_format = context.Get("input_serialization_format").As<Napi::Object>();
    Napi::Buffer headers_buf_obj = context.Get("records_header_buf").As<Napi::Buffer<uint8_t>>();
    _args_ref.Set("headers_buf", headers_buf_obj);
    headers_buf = headers_buf_obj.Data();
    headers_len = headers_buf_obj.Length();
    std::string query = context.Get("query").ToString();
    input_format = context.Get("input_format").ToString();
    s3select.parse_query(query.c_str());
    if (!s3select.get_error_description().empty()) {
        throw Napi::Error::New(env, XSTR() << "s3select: parse_query failed " << s3select.get_error_description());
    }
    if (input_format == JSON_FORMAT) {
        json_object = new s3selectEngine::json_object(&s3select);
    } else if (input_format == CSV_FORMAT) {
        s3selectEngine::csv_object::csv_defintions csv_defs;
        csv_defs.row_delimiter = GetStringWithDefault(input_serialization_format, "RecordDelimiter", "\n").c_str()[0];
        csv_defs.column_delimiter = GetStringWithDefault(input_serialization_format, "FieldDelimiter", ",").c_str()[0];
        csv_defs.ignore_header_info = (0 == GetStringWithDefault(input_serialization_format, "FileHeaderInfo", "").compare("IGNORE"));
        csv_defs.use_header_info = (0 == GetStringWithDefault(input_serialization_format, "FileHeaderInfo", "").compare("USE"));
        csv_defs.quote_fields_always = false;
        csv_object = new s3selectEngine::csv_object(&s3select, csv_defs);
#ifdef _ARROW_EXIST
    } else if (input_format == PARQUET_FORMAT) {
        Napi::Function handle_result = context.Get("handle_result").As<Napi::Function>();
        Napi::Object s3select_js_obj = context.Get("s3select_js").As<Napi::Object>();
        s3select_js_ref = Napi::Persistent(s3select_js_obj);
        parquet_page = Napi::ThreadSafeFunction::New(
            info.Env(),
            handle_result,
            "Handle Parquet Page",
            0,
            1,
            []( Napi::Env ) {} //empty finalizer
        );
        parquet_size_bytes = context.Get("size_bytes").As<Napi::Number>().Uint32Value();
        std::function<int(void)> fp_get_size=[&](){
            //std::cout << "returning size_bytes = " << parquet_size_bytes << std::endl;
            return parquet_size_bytes;
        };
        s3select_api.set_get_size_api(fp_get_size);

        parquet_file_path = context.Get("filepath").As<Napi::String>();
        Napi::Object fs_context = context.Get("fs_context").As<Napi::Object>();
        uid = fs_context.Get("uid").ToNumber();
        gid = fs_context.Get("gid").ToNumber();
        //std::cout << "parquet path = " << parquet_file_path << ", gid = " << gid << ", uid = " << uid << std::endl;
        ThreadScope tx;
        tx.set_user(uid, gid);

        parquet_file = fopen(parquet_file_path.c_str(), "r");
        if (nullptr == parquet_file) {
            throw std::runtime_error(XSTR() << "Failed to open " << parquet_file_path << ", errno = " << errno);
        }


        std::function<size_t(int64_t, int64_t, void *, optional_yield *)> fp_range_request =
        [&](int64_t start, int64_t length, void *buff, optional_yield *y) {
            //std::cout << "range req start = " << start << " ,length = " << length << std::endl;
            //std::cout << "range req path = " << parquet_file_path << " ,FILE = " << file << std::endl;

            int res = fseek(parquet_file, start, SEEK_SET);
            if (res) {
                throw std::runtime_error(XSTR() << "Failed to open " << parquet_file_path << ", errno = " << errno);
            }
            //std::cout << "range req fseek res = " << res << std::endl;
            size_t read_bytes = fread(buff, 1, length, parquet_file);
            if (read_bytes < length) {
                res = ferror(parquet_file);
                if(res){
                    throw std::runtime_error(XSTR() << "Failed to read " << parquet_file_path << ", res = " << res);
                }
            }
            //std::cout << "range req read = " << read_bytes << " bytes" << std::endl;
            parquet_read_bytes += read_bytes; //keep track of number of read bytes

            return read_bytes;
        };
        s3select_api.set_range_req_api(fp_range_request);
        try {
            parquet_object = new s3selectEngine::parquet_object(parquet_file_path, &s3select, &s3select_api);
        }
        catch(s3selectEngine::base_s3select_exception const &ex) {
            throw Napi::Error::New(env, XSTR() << "parquet error - " << ex.what());
        }
    } else {
        throw Napi::Error::New(env, XSTR() << "input_format must be either CSV, JSON or Parquet.");
#else
    } else {
        throw Napi::Error::New(env, XSTR() << "input_format must be either CSV or JSON.");
#endif
    }
}

S3SelectNapi::~S3SelectNapi()
{
    if (nullptr != csv_object) {
        delete csv_object;
    }
    if (nullptr != json_object) {
        delete json_object;
    }
#ifdef _ARROW_EXIST
    if (nullptr != parquet_object) {
        delete parquet_object;
        //parquet_page was started with 1 thread,
        //release it now we're done
        parquet_page.Release();
        fclose(parquet_file);
    }
#endif
}

} // namespace noobaa
