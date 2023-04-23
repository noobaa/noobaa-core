/* Copyright (C) 2016 NooBaa */

#include "../../../src/native/third_party/isa-l/include/crc.h"
#include "../../../submodules/s3select/include/s3select.h"
#include "../util/common.h"
#include "../util/napi.h"
#include <arpa/inet.h>

namespace noobaa
{

const char *CSV_FORMAT = "CSV";
const char *JSON_FORMAT = "JSON";
const char *PARQUET_FORMAT = "PARQUET";

class S3SelectNapi;

class SelectWorker : public Napi::AsyncWorker
{
public:
    Napi::ObjectReference _args_ref;
    Napi::Promise::Deferred _deferred;
    Napi::ObjectWrap<S3SelectNapi>& _wrap;
    s3selectEngine::csv_object *_csv_object;
    s3selectEngine::json_object *_json_object;
    std::string _select;
    const char* _buffer;
    const unsigned int _buffer_len;
    const bool _is_flush;
    const std::string _input_format;
    const uint8_t* _headers_bytes;
    const uint32_t _headers_len;

    SelectWorker(const Napi::CallbackInfo& info,
        Napi::ObjectWrap<S3SelectNapi>& wrap,
        s3selectEngine::csv_object* csv_object,
        s3selectEngine::json_object* json_object,
        const char* buffer,
        const unsigned int buffer_len,
        const bool is_flush,
        const std::string input_format,
        const uint8_t* headers_bytes,
        const uint32_t headers_len)
        : AsyncWorker(info.Env())
        , _args_ref(Napi::Persistent(Napi::Object::New(info.Env())))
        , _wrap(wrap)
        , _csv_object(csv_object)
        , _json_object(json_object)
        , _buffer(buffer)
        , _buffer_len(buffer_len)
        , _is_flush(is_flush)
        , _input_format(input_format)
        , _deferred(info.Env())
        , _headers_bytes(headers_bytes)
        , _headers_len(headers_len)
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
        } else {
            if (_is_flush) {
                rc = _json_object->run_s3select_on_stream(_select, nullptr, 0, 0);
            } else {
                rc = _json_object->run_s3select_on_stream(_select, _buffer, _buffer_len, SIZE_MAX);
            }
        }
        if (rc < 0) {
            if (CSV_FORMAT == _input_format) {
                SetError(_csv_object->get_error_description());
            } else {
                // SetError(json_object.get_error_description()); //TODO - they added a getter, use after submodule is updated
                SetError("failed to select from json");
            }
        }

        /*std::cout << "select res = " << this->select << std::endl;
        std::cout.flush();*/
    }

    void OnOK() override
    {
        Napi::Env env = Env();
        // in case of empty select result (ie, no rows in current buffer matched sql condition), return null
        if (_select.empty()) {
            _deferred.Resolve(env.Null());
            return;
        }

        Napi::Object result = Napi::Object::New(env);
        Napi::Value select_buf = Napi::Buffer<char>::/*New*/ Copy(env, _select.data(), _select.length());
        result.Set("select", select_buf);

        uint32_t prelude[3];
        int32_t prelude_crc, message_crc, prelude_crc_BE;
        prelude[0] = htonl(_select.length() + _headers_len + 16);
        prelude[1] = htonl(_headers_len);
        prelude_crc = crc32_gzip_refl_base(0, (uint8_t*)prelude, 8);
        result.Set("prelude_crc", prelude_crc);
        prelude_crc_BE = htonl(prelude_crc);
        /*std::cout << "sz = " << sizeof(headers_bytes) << ", native prelude_crc = " << prelude_crc << ", prelude = " << std::hex << std::setfill('0') << std::setw(2) << prelude[0] << prelude[1];
        std::cout << std::endl;
        std::cout.flush();*/
        message_crc = crc32_gzip_refl_base(prelude_crc, (uint8_t*)&prelude_crc_BE, 4);
        message_crc = crc32_gzip_refl_base(message_crc, const_cast<uint8_t*>(_headers_bytes), _headers_len);
        message_crc = crc32_gzip_refl_base(message_crc, (uint8_t*)_select.data(), _select.length());
        result.Set("message_crc", message_crc);

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
    ~S3SelectNapi();

private:
    static Napi::FunctionReference constructor;
    Napi::ObjectReference _args_ref;
    std::string input_format;
    s3selectEngine::s3select s3select;
    s3selectEngine::csv_object* csv_object = nullptr;
    s3selectEngine::json_object* json_object = nullptr;
    const uint8_t* headers_buf;
    uint32_t headers_len;
};

Napi::Value
S3SelectNapi::Write(const Napi::CallbackInfo& info)
{
    Napi::Buffer<char> buffer = info[0].As<Napi::Buffer<char>>();
    SelectWorker* worker = new SelectWorker(
        info,
        *this,
        csv_object,
        json_object,
        buffer.Data(),
        buffer.Length(),
        false,
        input_format,
        headers_buf,
        headers_len);
    worker->Queue();
    return worker->_deferred.Promise();
}

Napi::Value
S3SelectNapi::Flush(const Napi::CallbackInfo& info)
{
    SelectWorker* worker = new SelectWorker(
        info,
        *this,
        csv_object,
        json_object,
        nullptr, /*No buffer for flush*/
        0,
        true,
        input_format,
        headers_buf,
        headers_len);
    worker->Queue();
    return worker->_deferred.Promise();
}

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
            InstanceMethod("flush", &S3SelectNapi::Flush)
        }
    ); //end of DefineClass

    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();

    exports.Set("S3Select", func);
    return exports;
}

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
    Napi::Object context = info[0].As<Napi::Object>();
    Napi::Object input_serialization_format = context.Get("input_serialization_format").As<Napi::Object>();
    Napi::Buffer headers_buf_obj = context.Get("records_header_buf").As<Napi::Buffer<uint8_t>>();
    _args_ref.Set("headers_buf", headers_buf_obj);
    headers_buf = headers_buf_obj.Data();
    headers_len = headers_buf_obj.Length();
    std::string query = context.Get("query").ToString();
    input_format = context.Get("input_format").ToString();

    s3select.parse_query(query.c_str());
    if (!s3select.get_error_description().empty()) {
        throw Napi::Error::New(info.Env(), XSTR() << "s3select: parse_query failed " << s3select.get_error_description());
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
    } else {
        throw Napi::Error::New(info.Env(), XSTR() << "input_format is neither csv nor json");
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
}

} // namespace noobaa
