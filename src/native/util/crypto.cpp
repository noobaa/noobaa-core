/* Copyright (C) 2016 NooBaa */
#define WIN32_LEAN_AND_MEAN
#include "crypto.h"
#include <openssl/pem.h>
#include <openssl/rsa.h>

namespace noobaa
{

NAN_MODULE_INIT(Crypto::setup)
{
    LOG(SSLeay_version(SSLEAY_VERSION) << " setting up");
    OpenSSL_add_all_algorithms();
    OpenSSL_add_all_ciphers();
    OpenSSL_add_all_digests();
    ERR_load_crypto_strings();

    // https://wiki.openssl.org/index.php/Random_Numbers#Entropy
    // doing as suggested and seeding with /dev/random
    do {
        LOG(SSLeay_version(SSLEAY_VERSION) << " seeding randomness");
        const int RANDOM_SEED_LEN = 32;
        const int r = RAND_load_file("/dev/random", RANDOM_SEED_LEN);
        if (r != RANDOM_SEED_LEN) {
            PANIC("/dev/random seed failed " << r);
        }
    } while (!RAND_status());

    Nan::SetMethod(target, "rsa", rsa);
    Nan::SetMethod(target, "x509", x509);
    Nan::SetMethod(target, "x509_verify", x509_verify);
}

static void
write_pem_private(v8::Local<v8::Object> result, const char* name, EVP_PKEY* pkey)
{
    BIO* bio = BIO_new(BIO_s_mem());
    PEM_write_bio_PKCS8PrivateKey(bio, pkey, NULL, NULL, 0, NULL, NULL);
    char* data = NULL;
    long len = BIO_get_mem_data(bio, &data);
    NAN_SET(result, name, Nan::Encode(data, len, Nan::Encoding::UTF8));
    BIO_free(bio);
}

static void
write_pem_public(v8::Local<v8::Object> result, const char* name, EVP_PKEY* pkey)
{
    BIO* bio = BIO_new(BIO_s_mem());
    PEM_write_bio_PUBKEY(bio, pkey);
    char* data = NULL;
    long len = BIO_get_mem_data(bio, &data);
    NAN_SET(result, name, Nan::Encode(data, len, Nan::Encoding::UTF8));
    BIO_free(bio);
}

static void
write_pem_x509(v8::Local<v8::Object> result, const char* name, X509* x509)
{
    BIO* bio = BIO_new(BIO_s_mem());
    PEM_write_bio_X509(bio, x509);
    char* data = NULL;
    long len = BIO_get_mem_data(bio, &data);
    NAN_SET(result, name, Nan::Encode(data, len, Nan::Encoding::UTF8));
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
x509_name_from_entries(v8::Local<v8::Object> entries)
{
    X509_NAME* x509_name = X509_NAME_new();
    auto props = entries->GetOwnPropertyNames();
    const int num_props = props->Length();
    for (int i = 0; i < num_props; ++i) {
        auto prop = NAN_GET_STR(props, i);
        auto value = NAN_GET_STR(entries, prop);
        X509_NAME_add_entry_by_txt(
            x509_name, prop, MBSTRING_UTF8, reinterpret_cast<const unsigned char*>(value), -1, -1, 0);
    }
    return x509_name;
}

static v8::Local<v8::Object>
x509_name_to_entries(X509_NAME* x509_name)
{
    auto entries = NAN_NEW_OBJ();
    int num_entries = X509_NAME_entry_count(x509_name);
    for (int i = 0; i < num_entries; i++) {
        X509_NAME_ENTRY* e = X509_NAME_get_entry(x509_name, i);
        ASN1_OBJECT* o = X509_NAME_ENTRY_get_object(e);
        ASN1_STRING* d = X509_NAME_ENTRY_get_data(e);
        const char* key = OBJ_nid2sn(OBJ_obj2nid(o));
        const char* val = (const char*)ASN1_STRING_get0_data(d);
        NAN_SET_STR(entries, key, val);
    }
    return entries;
}

// avoid prompt passphrase which is the default callback in openssl
static int
no_password_callback(char* buf, int size, int rwflag, void* u)
{
    return 0;
}

/**
 * Create RSA key pair
 */
NAN_METHOD(Crypto::rsa)
{
    auto result = NAN_NEW_OBJ();
    int bits = 2048;

    if (info.Length() > 0 && info[0]->IsObject()) {
        auto options = info[0].As<v8::Object>();
        if (NAN_GET(options, "bits")->IsInt32()) {
            bits = NAN_GET_INT(options, "bits");
        }
    }

    EVP_PKEY* pkey = NULL;
    EVP_PKEY_CTX* ctx = EVP_PKEY_CTX_new_id(EVP_PKEY_RSA, NULL);
    EVP_PKEY_keygen_init(ctx);
    EVP_PKEY_CTX_set_rsa_keygen_bits(ctx, bits);
    EVP_PKEY_keygen(ctx, &pkey);
    write_pem_private(result, "private", pkey);
    write_pem_public(result, "public", pkey);
    EVP_PKEY_CTX_free(ctx);
    EVP_PKEY_free(pkey);
    NAN_RETURN(result);
}

/**
 * Create X509 certificate
 */
NAN_METHOD(Crypto::x509)
{
    auto result = NAN_NEW_OBJ();
    int days = 36500;
    X509_NAME* owner_x509_name = NULL;
    X509_NAME* issuer_x509_name = NULL;
    EVP_PKEY* issuer_private_key = NULL;
    EVP_PKEY* owner_public_key = NULL;
    EVP_PKEY_CTX* ctx = NULL;
    X509* x509 = NULL;

    if (info.Length() > 0 && info[0]->IsObject()) {
        auto options = info[0].As<v8::Object>();
        if (NAN_GET(options, "days")->IsInt32()) {
            days = NAN_GET_INT(options, "days");
        }
        if (NAN_GET(options, "owner")->IsObject()) {
            owner_x509_name = x509_name_from_entries(NAN_GET_OBJ(options, "owner"));
        }
        if (NAN_GET(options, "issuer")->IsObject()) {
            issuer_x509_name = x509_name_from_entries(NAN_GET_OBJ(options, "issuer"));
        }
        if (NAN_GET(options, "private")->IsString()) {
            auto private_str = NAN_GET_STR(options, "private");
            BIO* bio = BIO_new_mem_buf(private_str, strlen(private_str));
            issuer_private_key = PEM_read_bio_PrivateKey(bio, NULL, NULL, NULL);
            BIO_free(bio);
            if (!issuer_private_key) {
                Nan::ThrowError("Failed to read issuer private key in PEM format");
                goto cleanup;
            }
        }
        if (NAN_GET(options, "public")->IsString()) {
            auto public_str = NAN_GET_STR(options, "public");
            BIO* bio = BIO_new_mem_buf(public_str, strlen(public_str));
            owner_public_key = PEM_read_bio_PUBKEY(bio, NULL, NULL, NULL);
            BIO_free(bio);
            if (!owner_public_key) {
                Nan::ThrowError("Failed to read owner public key in PEM format");
                goto cleanup;
            }
        }
    }

    if (!owner_x509_name) {
        // the minimal name should have an organization
        owner_x509_name = X509_NAME_new();
        X509_NAME_add_entry_by_txt(
            owner_x509_name, "C", MBSTRING_UTF8, reinterpret_cast<const unsigned char*>("US"), -1, -1, 0);
        X509_NAME_add_entry_by_txt(
            owner_x509_name, "ST", MBSTRING_UTF8, reinterpret_cast<const unsigned char*>("California"), -1, -1, 0);
        X509_NAME_add_entry_by_txt(
            owner_x509_name, "O", MBSTRING_UTF8, reinterpret_cast<const unsigned char*>("SelfSigned"), -1, -1, 0);
    }
    if (!issuer_x509_name) issuer_x509_name = owner_x509_name;
    if (!issuer_private_key && !owner_public_key) {
        int bits = 2048;
        if (info.Length() > 0 && info[0]->IsObject()) {
            auto options = info[0].As<v8::Object>();
            if (NAN_GET(options, "bits")->IsInt32()) {
                bits = NAN_GET_INT(options, "bits");
            }
        }
        ctx = EVP_PKEY_CTX_new_id(EVP_PKEY_RSA, NULL);
        EVP_PKEY_keygen_init(ctx);
        EVP_PKEY_CTX_set_rsa_keygen_bits(ctx, bits);
        EVP_PKEY_keygen(ctx, &issuer_private_key);
        owner_public_key = issuer_private_key;
    }
    if (!issuer_private_key) {
        Nan::ThrowError("Missing issuer private key");
        goto cleanup;
    }
    if (!owner_public_key) {
        Nan::ThrowError("Missing owner public key");
        goto cleanup;
    }

    // prepare an x509 certificate
    x509 = X509_new();
    // version is zero based - 2 means v3
    X509_set_version(x509, 2);
    // some clients require the serial number to be non 0 which is default so
    // setting
    ASN1_INTEGER_set(X509_get_serialNumber(x509), 1);
    // set times - notBefore now, notAfter now+days
    X509_gmtime_adj(X509_get_notBefore(x509), 0);
    X509_time_adj_ex(X509_get_notAfter(x509), days, 0, NULL);
    // set the owner's certificate details (called subject)
    X509_set_subject_name(x509, owner_x509_name);
    // set the issuer certificate details - the certificate authority
    X509_set_issuer_name(x509, issuer_x509_name);
    // set the owner's public key to be signed
    X509_set_pubkey(x509, owner_public_key);
    // sign the certificate with the private key of the issuer
    X509_sign(x509, issuer_private_key, EVP_sha256());

    write_pem_private(result, "key", issuer_private_key);
    write_pem_x509(result, "cert", x509);
    NAN_RETURN(result);

cleanup:
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
}

/**
 * Verify X509 certificate
 */
NAN_METHOD(Crypto::x509_verify)
{
    auto result = NAN_NEW_OBJ();
    EVP_PKEY* issuer_private_key = NULL;
    X509* x509 = NULL;

    if (info.Length() > 0 && info[0]->IsObject()) {
        auto options = info[0].As<v8::Object>();
        if (NAN_GET(options, "key")->IsString()) {
            auto private_str = NAN_GET_STR(options, "key");
            BIO* bio = BIO_new_mem_buf(private_str, strlen(private_str));
            issuer_private_key = PEM_read_bio_PrivateKey(bio, NULL, NULL, NULL);
            BIO_free(bio);
            if (!issuer_private_key) {
                Nan::ThrowError(
                    (std::string("Private key PEM decode failed: ") + ERR_reason_error_string(ERR_get_error()))
                        .c_str());
                goto cleanup;
            }
        }
        if (NAN_GET(options, "cert")->IsString()) {
            auto x509_str = NAN_GET_STR(options, "cert");
            BIO* bio = BIO_new_mem_buf(x509_str, strlen(x509_str));
            x509 = PEM_read_bio_X509(bio, NULL, no_password_callback, NULL);
            BIO_free(bio);
            if (!x509) {
                Nan::ThrowError(
                    (std::string("X509 PEM decode failed: ") + ERR_reason_error_string(ERR_get_error())).c_str());
                goto cleanup;
            }
        }
    }

    if (!issuer_private_key || !x509) {
        Nan::ThrowError("Expected private key and cert");
        goto cleanup;
    }

    switch (EVP_PKEY_base_id(issuer_private_key)) {
    case EVP_PKEY_RSA:
    case EVP_PKEY_RSA2: {
        RSA* rsa = EVP_PKEY_get1_RSA(issuer_private_key);
        int rc = RSA_check_key(rsa);
        RSA_free(rsa);
        if (rc != 1) {
            Nan::ThrowError((std::string("RSA check key failed: ") + ERR_reason_error_string(ERR_get_error())).c_str());
            goto cleanup;
        }
        break;
    }
    default:
        Nan::ThrowError("Unsupported private key type");
        goto cleanup;
    }

    if (X509_verify(x509, issuer_private_key) != 1) {
        Nan::ThrowError((std::string("X509 verify failed: ") + ERR_reason_error_string(ERR_get_error())).c_str());
        goto cleanup;
    }

    NAN_SET(result, "owner", x509_name_to_entries(X509_get_subject_name(x509)));
    NAN_SET(result, "issuer", x509_name_to_entries(X509_get_issuer_name(x509)));
    NAN_RETURN(result);

cleanup:
    EVP_PKEY_free(issuer_private_key);
    X509_free(x509);
}

} // namespace noobaa
