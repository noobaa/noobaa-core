/* Copyright (C) 2016 NooBaa */
#include <string.h>

#include <openssl/err.h>
#include <openssl/evp.h>
#include <openssl/pem.h>
#include <openssl/rand.h>
#include <openssl/rsa.h>
#include <openssl/sha.h>
#include <openssl/x509v3.h>

#include "../third_party/isa-l_crypto/include/md5_mb.h"
#include "../third_party/isa-l_crypto/include/sha1_mb.h"

// Under Win32 these are defined in wincrypt.h
#ifdef OPENSSL_SYS_WIN32
#undef X509_NAME
#undef X509_EXTENSIONS
#include <openssl/ossl_typ.h>
#endif

#include "../util/common.h"
#include "../util/endian.h"
#include "../util/napi.h"

namespace noobaa
{

bool fips_mode = false;

static Napi::Value set_fips_mode(const Napi::CallbackInfo& info);
static Napi::Value rand_seed(const Napi::CallbackInfo& info);

/**
 * X509 certificate
 */
static napi_value _nb_x509(napi_env env, napi_callback_info info);
static napi_value _nb_x509_verify(napi_env env, napi_callback_info info);
static napi_value _nb_rsa(napi_env env, napi_callback_info info);
static void write_pem_private(napi_env env, napi_value result, const char* name, EVP_PKEY* pkey);
static void write_pem_public(napi_env env, napi_value result, const char* name, EVP_PKEY* pkey);
static void write_pem_x509(napi_env env, napi_value result, const char* name, X509* x509);
static X509_NAME* x509_name_from_entries(napi_env env, napi_value entries);
static napi_value x509_name_to_entries(napi_env env, X509_NAME* x509_name);
static int no_password_callback(char* buf, int size, int rwflag, void* u);

#define HASHER_TEMPLATE const char ALG[],                                                 \
                        size_t NWORDS,                                                    \
                        bool WORDS_BE,                                                    \
                        typename MGR,                                                     \
                        typename CTX,                                                     \
                        void (*INIT)(MGR*),                                               \
                        CTX *(*SUBMIT)(MGR*, CTX*, const void*, uint32_t, HASH_CTX_FLAG), \
                        CTX *(*FLUSH)(MGR*)

#define HASHER_ARGS Hasher<ALG, NWORDS, WORDS_BE, MGR, CTX, INIT, SUBMIT, FLUSH>

template <HASHER_TEMPLATE>
class Hasher : public Napi::ObjectWrap<HASHER_ARGS>
{
private:
    DECLARE_ALIGNED(MGR _mgr, 16);
    DECLARE_ALIGNED(CTX _ctx, 16);

public:
    Hasher(const Napi::CallbackInfo& info)
        : Napi::ObjectWrap<Hasher>(info)
    {
        Napi::Env env = info.Env();
        Napi::HandleScope scope(env);
        hash_ctx_init(&_ctx);
        INIT(&_mgr);
        submit_and_flush(0, 0, HASH_FIRST);
    }

    Napi::Value update(const Napi::CallbackInfo& info)
    {
        Napi::Env env = info.Env();
        if (!info[0].IsBuffer()) {
            Napi::TypeError::New(env, XSTR() << "Hasher<" << ALG << ">.update: expected buffer").ThrowAsJavaScriptException();
            return Napi::Value();
        }
        Napi::Buffer<uint8_t> buf = info[0].As<Napi::Buffer<uint8_t>>();
        submit_and_flush(buf.Data(), buf.Length(), HASH_UPDATE);
        return info.This();
    }

    Napi::Value digest(const Napi::CallbackInfo& info)
    {
        Napi::Env env = info.Env();
        submit_and_flush(0, 0, HASH_LAST);
        uint32_t digest[NWORDS];
        for (size_t i = 0; i < NWORDS; i++) {
            digest[i] = WORDS_BE ? be32toh(hash_ctx_digest(&_ctx)[i]) : le32toh(hash_ctx_digest(&_ctx)[i]);
        }
        return Napi::Buffer<uint32_t>::Copy(env, digest, NWORDS);
    }

    void submit_and_flush(const void* data, uint32_t size, HASH_CTX_FLAG flag)
    {
        SUBMIT(&_mgr, &_ctx, data, size, flag);
        while (hash_ctx_processing(&_ctx)) {
            FLUSH(&_mgr);
        }
    }

public:
    static Napi::FunctionReference constructor;
    static void init(Napi::Env env)
    {
        Napi::HandleScope scope(env);
        Napi::Function func = HASHER_ARGS::DefineClass(
            env,
            ALG,
            {
                HASHER_ARGS::InstanceMethod("update", &HASHER_ARGS::update),
                HASHER_ARGS::InstanceMethod("digest", &HASHER_ARGS::digest),
            });
        constructor = Napi::Persistent(func);
        constructor.SuppressDestruct();
    }
};

template <HASHER_TEMPLATE>
Napi::FunctionReference HASHER_ARGS::constructor;

const char MD5_MB_ALG[] = "MD5_MB";
const char SHA1_MB_ALG[] = "SHA1_MB";

typedef Hasher<
    MD5_MB_ALG,
    MD5_DIGEST_NWORDS,
    false, // Digest words for MD5 are little-endian
    MD5_HASH_CTX_MGR,
    MD5_HASH_CTX,
    md5_ctx_mgr_init,
    md5_ctx_mgr_submit,
    md5_ctx_mgr_flush>
    MD5_MB;

typedef Hasher<
    SHA1_MB_ALG,
    SHA1_DIGEST_NWORDS,
    true, // Digest words for SHA1 are big-endian
    SHA1_HASH_CTX_MGR,
    SHA1_HASH_CTX,
    sha1_ctx_mgr_init,
    sha1_ctx_mgr_submit,
    sha1_ctx_mgr_flush>
    SHA1_MB;

void
ssl_napi(Napi::Env env, Napi::Object exports)
{
    printf("%s setting up\n", SSLeay_version(SSLEAY_VERSION));
    OpenSSL_add_all_algorithms();
    OpenSSL_add_all_ciphers();
    OpenSSL_add_all_digests();
    ERR_load_crypto_strings();

    MD5_MB::init(env);
    SHA1_MB::init(env);

    exports["rand_seed"] = Napi::Function::New(env, rand_seed);
    exports["set_fips_mode"] = Napi::Function::New(env, set_fips_mode);
    exports["MD5_MB"] = MD5_MB::constructor.Value();
    exports["SHA1_MB"] = SHA1_MB::constructor.Value();

    napi_value func = 0;
    napi_create_function(env, "x509", NAPI_AUTO_LENGTH, _nb_x509, NULL, &func);
    napi_set_named_property(env, exports, "x509", func);
    napi_create_function(env, "x509_verify", NAPI_AUTO_LENGTH, _nb_x509_verify, NULL, &func);
    napi_set_named_property(env, exports, "x509_verify", func);
    napi_create_function(env, "rsa", NAPI_AUTO_LENGTH, _nb_rsa, NULL, &func);
    napi_set_named_property(env, exports, "rsa", func);
}

static Napi::Value
set_fips_mode(const Napi::CallbackInfo& info)
{
    fips_mode = info[0].ToBoolean().Value();
    return Napi::Value();
}

// https://wiki.openssl.org/index.php/Random_Numbers#Entropy
static Napi::Value
rand_seed(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();

    printf("rand_seed: %s seeding randomness\n", SSLeay_version(SSLEAY_VERSION));

    if (!info[0].IsBuffer()) {
        Napi::TypeError::New(env, "rand_seed: expected buffer").ThrowAsJavaScriptException();
        return Napi::Value();
    }

    Napi::Buffer<uint8_t> buf = info[0].As<Napi::Buffer<uint8_t>>();
    RAND_seed(buf.Data(), buf.Length());

    if (!RAND_status()) {
        Napi::Error::New(env, "rand_seed: rand status is not good").ThrowAsJavaScriptException();
        return Napi::Value();
    }

    return Napi::Value();
}

static napi_value
_nb_x509(napi_env env, napi_callback_info info)
{
    napi_value result = 0;
    int days = 2 * 365; // limit by new clients to 825 days
    char* dns_buf = NULL;
    X509_EXTENSION* ext_key_usage = NULL;
    X509_EXTENSION* ext_subject_alt_name = NULL;
    X509_NAME* owner_x509_name = NULL;
    X509_NAME* issuer_x509_name = NULL;
    EVP_PKEY* issuer_private_key = NULL;
    EVP_PKEY* owner_public_key = NULL;
    EVP_PKEY_CTX* ctx = NULL;
    X509* x509 = NULL;

    StackCleaner cleaner([&] {
        free(dns_buf);
        X509_EXTENSION_free(ext_key_usage);
        X509_EXTENSION_free(ext_subject_alt_name);
        if (issuer_x509_name != owner_x509_name) {
            X509_NAME_free(issuer_x509_name);
        }
        if (owner_public_key != issuer_private_key) {
            EVP_PKEY_free(owner_public_key);
        }
        X509_NAME_free(owner_x509_name);
        EVP_PKEY_free(issuer_private_key);
        EVP_PKEY_CTX_free(ctx);
        X509_free(x509);
    });

    size_t argc = 1;
    napi_value argv[] = { 0 };
    napi_get_cb_info(env, info, &argc, argv, 0, 0);

    napi_value v = 0;
    napi_valuetype vt = napi_undefined;
    napi_value v_options = argv[0];
    napi_valuetype v_options_type = napi_undefined;
    napi_typeof(env, v_options, &v_options_type);

    if (v_options_type == napi_object) {

        napi_get_named_property(env, v_options, "days", &v);
        napi_get_value_int32(env, v, &days);

        napi_get_named_property(env, v_options, "dns", &v);
        napi_typeof(env, v, &vt);
        if (vt == napi_string) {
            size_t dns_len = 0;
            napi_get_value_string_utf8(env, v, 0, 0, &dns_len);
            dns_len += 5; // for null terminator + "DNS:" prefix
            dns_buf = (char*)malloc(dns_len);
            napi_get_value_string_utf8(env, v, dns_buf + 4, dns_len - 4, 0);
            dns_buf[0] = 'D';
            dns_buf[1] = 'N';
            dns_buf[2] = 'S';
            dns_buf[3] = ':';
        }

        napi_get_named_property(env, v_options, "owner", &v);
        napi_typeof(env, v, &vt);
        if (vt == napi_object) {
            owner_x509_name = x509_name_from_entries(env, v);
        }

        napi_get_named_property(env, v_options, "issuer", &v);
        napi_typeof(env, v, &vt);
        if (vt == napi_object) {
            issuer_x509_name = x509_name_from_entries(env, v);
        }

        napi_get_named_property(env, v_options, "private", &v);
        napi_typeof(env, v, &vt);
        if (vt == napi_string) {
            size_t private_len = 0;
            napi_get_value_string_utf8(env, v, 0, 0, &private_len);
            private_len++; // for null terminator
            char* private_str = (char*)malloc(private_len);
            napi_get_value_string_utf8(env, v, private_str, private_len, 0);
            BIO* bio = BIO_new_mem_buf(private_str, private_len);
            issuer_private_key = PEM_read_bio_PrivateKey(bio, NULL, NULL, NULL);
            BIO_free(bio);
            free(private_str);
            if (!issuer_private_key) {
                napi_throw_error(env, 0, "Failed to read issuer private key in PEM format");
                return 0;
            }
        }

        napi_get_named_property(env, v_options, "public", &v);
        napi_typeof(env, v, &vt);
        if (vt == napi_string) {
            size_t public_len = 0;
            napi_get_value_string_utf8(env, v, 0, 0, &public_len);
            public_len++; // for null terminator
            char* public_str = (char*)malloc(public_len);
            napi_get_value_string_utf8(env, v, public_str, public_len, 0);
            BIO* bio = BIO_new_mem_buf(public_str, strlen(public_str));
            owner_public_key = PEM_read_bio_PUBKEY(bio, NULL, NULL, NULL);
            BIO_free(bio);
            free(public_str);
            if (!owner_public_key) {
                napi_throw_error(env, 0, "Failed to read owner public key in PEM format");
                return 0;
            }
        }
    }

    const char* dns_str = dns_buf != NULL ? dns_buf : "DNS:selfsigned.noobaa.io";
    ext_key_usage = X509V3_EXT_conf_nid(NULL, NULL, NID_ext_key_usage, "serverAuth");
    ext_subject_alt_name = X509V3_EXT_conf_nid(NULL, NULL, NID_subject_alt_name, dns_str);
    if (!owner_x509_name) {
        // the minimal name should have an organization
        owner_x509_name = X509_NAME_new();
        X509_NAME_add_entry_by_txt(
            owner_x509_name, "CN", MBSTRING_UTF8, (const unsigned char*)(dns_str + 4), -1, -1, 0);
        X509_NAME_add_entry_by_txt(
            owner_x509_name, "C", MBSTRING_UTF8, (const unsigned char*)"US", -1, -1, 0);
        X509_NAME_add_entry_by_txt(
            owner_x509_name, "ST", MBSTRING_UTF8, (const unsigned char*)"California", -1, -1, 0);
        X509_NAME_add_entry_by_txt(
            owner_x509_name, "O", MBSTRING_UTF8, (const unsigned char*)"SelfSigned", -1, -1, 0);
    }
    if (!issuer_x509_name) issuer_x509_name = owner_x509_name;
    if (!issuer_private_key && !owner_public_key) {
        int bits = 2048;
        if (v_options_type == napi_object) {
            napi_get_named_property(env, v_options, "bits", &v);
            napi_get_value_int32(env, v, &bits);
        }
        ctx = EVP_PKEY_CTX_new_id(EVP_PKEY_RSA, NULL);
        EVP_PKEY_keygen_init(ctx);
        EVP_PKEY_CTX_set_rsa_keygen_bits(ctx, bits);
        EVP_PKEY_keygen(ctx, &issuer_private_key);
        owner_public_key = issuer_private_key;
    }
    if (!issuer_private_key) {
        napi_throw_error(env, 0, "Missing issuer private key");
        return 0;
    }
    if (!owner_public_key) {
        napi_throw_error(env, 0, "Missing owner public key");
        return 0;
    }

    // prepare an x509 certificate
    x509 = X509_new();
    // version is zero based - 2 means v3
    X509_set_version(x509, 2);
    // some clients require the serial number to be non 0 which is default
    ASN1_INTEGER_set(X509_get_serialNumber(x509), 1);
    // set times - notBefore now, notAfter now+days
    X509_gmtime_adj(X509_get_notBefore(x509), 0);
    X509_time_adj_ex(X509_get_notAfter(x509), days, 0, NULL);
    // set ExtendedKeyUsage extension to serverAuth
    X509_add_ext(x509, ext_key_usage, -1);
    // set SubjectAlternateName extension to dns name
    X509_add_ext(x509, ext_subject_alt_name, -1);
    // set the owner's certificate details (called subject)
    X509_set_subject_name(x509, owner_x509_name);
    // set the issuer certificate details - the certificate authority
    X509_set_issuer_name(x509, issuer_x509_name);
    // set the owner's public key to be signed
    X509_set_pubkey(x509, owner_public_key);
    // sign the certificate with the private key of the issuer
    X509_sign(x509, issuer_private_key, EVP_sha256());

    napi_create_object(env, &result);
    write_pem_private(env, result, "key", issuer_private_key);
    write_pem_x509(env, result, "cert", x509);

    return result;
}

static napi_value
_nb_x509_verify(napi_env env, napi_callback_info info)
{
    napi_value result = 0;
    EVP_PKEY* issuer_private_key = NULL;
    X509* x509 = NULL;

    StackCleaner cleaner([&] {
        EVP_PKEY_free(issuer_private_key);
        X509_free(x509);
    });

    size_t argc = 1;
    napi_value argv[] = { 0 };
    napi_get_cb_info(env, info, &argc, argv, 0, 0);

    napi_value v = 0;
    napi_valuetype vt = napi_undefined;
    napi_value v_options = argv[0];
    napi_valuetype v_options_type = napi_undefined;
    napi_typeof(env, v_options, &v_options_type);

    if (v_options_type == napi_object) {

        napi_get_named_property(env, v_options, "key", &v);
        napi_typeof(env, v, &vt);
        if (vt == napi_string) {
            size_t private_len = 0;
            napi_get_value_string_utf8(env, v, 0, 0, &private_len);
            private_len++; // for null terminator
            char* private_str = (char*)malloc(private_len);
            napi_get_value_string_utf8(env, v, private_str, private_len, 0);
            BIO* bio = BIO_new_mem_buf(private_str, private_len);
            issuer_private_key = PEM_read_bio_PrivateKey(bio, NULL, NULL, NULL);
            BIO_free(bio);
            free(private_str);
            if (!issuer_private_key) {
                napi_throw_error(env, 0, "Private key PEM decode failed");
                // ERR_reason_error_string(ERR_get_error())
                return 0;
            }
        }

        napi_get_named_property(env, v_options, "cert", &v);
        napi_typeof(env, v, &vt);
        if (vt == napi_string) {
            size_t cert_len = 0;
            napi_get_value_string_utf8(env, v, 0, 0, &cert_len);
            cert_len++; // for null terminator
            char* cert_str = (char*)malloc(cert_len);
            napi_get_value_string_utf8(env, v, cert_str, cert_len, 0);
            BIO* bio = BIO_new_mem_buf(cert_str, cert_len);
            x509 = PEM_read_bio_X509(bio, NULL, no_password_callback, NULL);
            BIO_free(bio);
            free(cert_str);
            if (!x509) {
                napi_throw_error(env, 0, "X509 PEM decode failed");
                // ERR_reason_error_string(ERR_get_error())
                return 0;
            }
        }
    }

    if (!issuer_private_key || !x509) {
        napi_throw_error(env, 0, "Expected private key and cert");
        return 0;
    }

    switch (EVP_PKEY_base_id(issuer_private_key)) {
    case EVP_PKEY_RSA:
    case EVP_PKEY_RSA2: {
        RSA* rsa = EVP_PKEY_get1_RSA(issuer_private_key);
        int rc = RSA_check_key(rsa);
        RSA_free(rsa);
        if (rc != 1) {
            napi_throw_error(env, 0, "RSA check key failed");
            return 0;
        }
        break;
    }
    default:
        napi_throw_error(env, 0, "Unsupported private key type");
        return 0;
    }

    if (X509_verify(x509, issuer_private_key) != 1) {
        napi_throw_error(env, 0, "X509 verify failed");
        return 0;
    }

    napi_create_object(env, &result);
    napi_set_named_property(
        env, result, "owner", x509_name_to_entries(env, X509_get_subject_name(x509)));
    napi_set_named_property(
        env, result, "issuer", x509_name_to_entries(env, X509_get_issuer_name(x509)));

    return result;
}

/**
 * Create RSA key pair
 */
static napi_value
_nb_rsa(napi_env env, napi_callback_info info)
{
    napi_value result = 0;
    int bits = 2048;

    size_t argc = 1;
    napi_value argv[] = { 0 };
    napi_get_cb_info(env, info, &argc, argv, 0, 0);

    napi_value v = 0;
    napi_value v_options = argv[0];
    napi_valuetype v_options_type = napi_undefined;
    napi_typeof(env, v_options, &v_options_type);
    if (v_options_type == napi_object) {
        napi_get_named_property(env, v_options, "bits", &v);
        napi_get_value_int32(env, v, &bits);
    }

    EVP_PKEY* pkey = NULL;
    EVP_PKEY_CTX* ctx = EVP_PKEY_CTX_new_id(EVP_PKEY_RSA, NULL);
    EVP_PKEY_keygen_init(ctx);
    EVP_PKEY_CTX_set_rsa_keygen_bits(ctx, bits);
    EVP_PKEY_keygen(ctx, &pkey);

    napi_create_object(env, &result);
    write_pem_private(env, result, "private", pkey);
    write_pem_public(env, result, "public", pkey);

    EVP_PKEY_CTX_free(ctx);
    EVP_PKEY_free(pkey);
    return result;
}

static void
write_pem_private(napi_env env, napi_value result, const char* name, EVP_PKEY* pkey)
{
    BIO* bio = BIO_new(BIO_s_mem());
    PEM_write_bio_PKCS8PrivateKey(bio, pkey, NULL, NULL, 0, NULL, NULL);
    char* data = NULL;
    long len = BIO_get_mem_data(bio, &data);
    napi_value v;
    napi_create_string_utf8(env, data, len, &v);
    napi_set_named_property(env, result, name, v);
    BIO_free(bio);
}

static void
write_pem_public(napi_env env, napi_value result, const char* name, EVP_PKEY* pkey)
{
    BIO* bio = BIO_new(BIO_s_mem());
    PEM_write_bio_PUBKEY(bio, pkey);
    char* data = NULL;
    long len = BIO_get_mem_data(bio, &data);
    napi_value v;
    napi_create_string_utf8(env, data, len, &v);
    napi_set_named_property(env, result, name, v);
    BIO_free(bio);
}

static void
write_pem_x509(napi_env env, napi_value result, const char* name, X509* x509)
{
    BIO* bio = BIO_new(BIO_s_mem());
    PEM_write_bio_X509(bio, x509);
    char* data = NULL;
    long len = BIO_get_mem_data(bio, &data);
    napi_value v;
    napi_create_string_utf8(env, data, len, &v);
    napi_set_named_property(env, result, name, v);
    BIO_free(bio);
}

/**
 * Create x509 certificate details (aka X509_NAME)
 * Example entries object:
 *  {
 *      "C": "US",
 *      "ST": "California",
 *      "L": "San Francisco",
 *      "O": "NooBaa Organization",
 *      "OU": "Self Signed",
 *      "CN": "*.noobaa.com",
 *  }
 */
static X509_NAME*
x509_name_from_entries(napi_env env, napi_value entries)
{
    X509_NAME* x509_name = X509_NAME_new();
    napi_value v_props = 0;
    uint32_t num_props = 0;
    napi_get_property_names(env, entries, &v_props);
    napi_get_array_length(env, v_props, &num_props);
    for (uint32_t i = 0; i < num_props; ++i) {
        napi_value v_prop;
        napi_value v_value;
        char prop[16];
        char value[256];
        napi_get_element(env, v_props, i, &v_prop);
        napi_get_value_string_utf8(env, v_prop, prop, sizeof(prop), 0);
        napi_get_named_property(env, entries, prop, &v_value);
        napi_get_value_string_utf8(env, v_value, value, sizeof(value), 0);
        X509_NAME_add_entry_by_txt(
            x509_name, prop, MBSTRING_UTF8, (const unsigned char*)value, -1, -1, 0);
    }
    return x509_name;
}

static napi_value
x509_name_to_entries(napi_env env, X509_NAME* x509_name)
{
    napi_value v_entries = 0;
    napi_create_object(env, &v_entries);
    int num_entries = X509_NAME_entry_count(x509_name);
    for (int i = 0; i < num_entries; i++) {
        X509_NAME_ENTRY* e = X509_NAME_get_entry(x509_name, i);
        ASN1_OBJECT* o = X509_NAME_ENTRY_get_object(e);
        ASN1_STRING* d = X509_NAME_ENTRY_get_data(e);
        const char* key = OBJ_nid2sn(OBJ_obj2nid(o));
        const char* val = (const char*)ASN1_STRING_get0_data(d);
        napi_value v = 0;
        napi_create_string_utf8(env, val, NAPI_AUTO_LENGTH, &v);
        napi_set_named_property(env, v_entries, key, v);
    }
    return v_entries;
}

// avoid prompt passphrase which is the default callback in openssl
static int
no_password_callback(char* buf, int size, int rwflag, void* u)
{
    return 0;
}
} // namespace noobaa
