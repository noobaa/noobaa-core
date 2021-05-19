/* Copyright (C) 2016 NooBaa */
#include <iostream>
#include <fstream>
#include <stdio.h>

#include <aws/s3/S3Client.h>
#include <aws/s3/model/PutObjectRequest.h>
#include <aws/s3/model/GetObjectRequest.h>
#include <aws/s3/model/DeleteObjectRequest.h>
#include <aws/s3/model/HeadObjectRequest.h>
#include <aws/s3/model/CreateMultipartUploadRequest.h>
#include <aws/s3/model/UploadPartRequest.h>
#include <aws/s3/model/CompleteMultipartUploadRequest.h>
#include <aws/s3/model/ListObjectsRequest.h>
#include <aws/s3/model/GetBucketLocationRequest.h>

#include <aws/core/http/HttpClientFactory.h>
#include <aws/core/http/HttpClient.h>
#include <aws/core/utils/DateTime.h>
#include <aws/core/utils/HashingUtils.h>
#include <aws/core/utils/StringUtils.h>
#include <aws/core/utils/logging/ConsoleLogSystem.h>
#include <aws/core/utils/logging/AWSLogging.h>
#include <aws/core/utils/memory/stl/AWSString.h>
#include <aws/core/utils/memory/stl/AWSStringStream.h>
#include <aws/core/auth/AWSCredentialsProviderChain.h>

using std::cout;
using std::cerr;
using std::endl;
using std::string;
using std::ifstream;

typedef std::shared_ptr<Aws::S3::S3Client> S3ClientSharedPtr;
typedef std::map<string,string> FlagsMap;
typedef std::vector<string> ArgsVec;
#define MEMTAG "memtag"

struct DemoOptions {
    string fname;
    string content_type;
    string endpoint;
    string bucket;
    string key;
    string access_key;
    string secret_key;
    int log_level; // level (0-6)
    DemoOptions(int ac, char** av);
};

static S3ClientSharedPtr create_s3_client(string endpoint, string access_key, string secret_key);
static string upload_file_to_s3(S3ClientSharedPtr s3, string fname, string bucket, string key);
static string download_file_from_s3(S3ClientSharedPtr s3, string fname, string bucket, string key);
static void start_aws_logging(int log_level);


/**
 *
 * main
 *
 */
int main(int ac, char** av)
{
    try {

        S3ClientSharedPtr s3;
        string md5_up;
        string md5_down;
        DemoOptions opt(ac, av);

        cout << endl << " ===> Starting ..." << endl;

        start_aws_logging(opt.log_level);

        s3 = create_s3_client(opt.endpoint, opt.access_key, opt.secret_key);

        md5_up = upload_file_to_s3(s3, opt.fname, opt.bucket, opt.key);

        md5_down = download_file_from_s3(s3, opt.fname, opt.bucket, opt.key);

        if (md5_up != md5_down) {
            cout << endl << "ERROR ===> Houston, we have an md5 problem"
                << " up=\"" << md5_up << "\""
                << " down=\"" << md5_down << "\""
                << endl << endl;
        } else {
            cout << " ===> MD5 Matched." << endl;
            cout << " ===> Done." << endl;
        }

    } catch (const std::exception& ex) {
        cerr << ex.what() << endl;
    }

    return 0;
}


/**
 *
 * create_s3_client
 *
 */
S3ClientSharedPtr create_s3_client(string endpoint, string access_key, string secret_key)
{
    Aws::Client::ClientConfiguration config;
    config.endpointOverride = endpoint;
    config.verifySSL = false; // accept self signed ssl certificate from server
    config.scheme = Aws::Http::Scheme::HTTPS;
    config.region = Aws::Region::US_EAST_1;
    config.connectTimeoutMs = 30000;
    config.requestTimeoutMs = 24 * 3600 * 1000; // 24h

    S3ClientSharedPtr s3_client = Aws::MakeShared<Aws::S3::S3Client>(
        MEMTAG,
        Aws::Auth::AWSCredentials(access_key, secret_key),
        config);

    return s3_client;
}


/**
 *
 * upload_file_to_s3
 *
 */
string upload_file_to_s3(S3ClientSharedPtr s3, string fname, string bucket, string key)
{
    cout << " ===> S3 Upload ..." << endl;

    // open the file for read
    std::shared_ptr<Aws::FStream> file = Aws::MakeShared<Aws::FStream>(
        MEMTAG,
        fname,
        std::ios::in|std::ios::binary|std::ios::ate);

    if (!file->is_open()) {
        throw std::runtime_error(string("File not found: ") + fname);
    }

    // we opened the file at end to get size, then seek to begin
    const std::streampos fsize = file->tellg();
    file->seekg(0, std::ios::beg);

    Aws::Utils::ByteBuffer md5 = Aws::Utils::HashingUtils::CalculateMD5(*file);

    // upload the file
    Aws::S3::Model::PutObjectRequest req;
    req.SetBucket(bucket);
    req.SetKey(key);
    req.SetContentType("video/mp4");
    req.SetBody(file);
    req.SetContentLength(fsize);
    req.SetContentMD5(Aws::Utils::HashingUtils::Base64Encode(md5));
    Aws::S3::Model::PutObjectOutcome putObjectOutcome =
        s3->PutObject(req);

    if (!putObjectOutcome.IsSuccess()) {
        throw std::runtime_error(string("S3 Upload Failed: ") + fname);
    }

    file->close();
    cout << " ===> S3 Upload Done." << endl;
    return Aws::Utils::HashingUtils::HexEncode(md5);
}


/**
 *
 * download_file_from_s3
 *
 */
string download_file_from_s3(S3ClientSharedPtr s3, string fname, string bucket, string key)
{
    cout << " ===> S3 Download ..." << endl;
    string dlname = fname + ".S3-DEMO";

    Aws::S3::Model::GetObjectRequest req;
    req.SetBucket(bucket);
    req.SetKey(key);
    req.SetResponseStreamFactory([dlname](){
        return Aws::New<Aws::FStream>(MEMTAG, dlname, std::ios::out|std::ios::binary);
    });
    Aws::S3::Model::GetObjectOutcome getObjectOutcome =
        s3->GetObject(req);

    if (!getObjectOutcome.IsSuccess()) {
        throw std::runtime_error(string("S3 Download Failed: ") + fname);
    }

    // to calculate md5 open the downloaded file for read
    std::shared_ptr<Aws::FStream> file = Aws::MakeShared<Aws::FStream>(
        MEMTAG,
        dlname,
        std::ios::in|std::ios::binary);

    if (!file->is_open()) {
        throw std::runtime_error(string("Downloaded file not found: ") + dlname);
    }

    Aws::Utils::ByteBuffer md5 = Aws::Utils::HashingUtils::CalculateMD5(*file);
    file->close();

    cout << " ===> S3 Download Done." << endl;
    return Aws::Utils::HashingUtils::HexEncode(md5);
}



///////////////
// utilities //
///////////////


// setup aws logging to console
void start_aws_logging(int log_level)
{
    Aws::Utils::Logging::InitializeAWSLogging(
        Aws::MakeShared<Aws::Utils::Logging::ConsoleLogSystem>(
            MEMTAG,
            static_cast<Aws::Utils::Logging::LogLevel>(log_level)));

}


// if will need aws to stop logging we can call this
void stop_aws_logging()
{
    Aws::Utils::Logging::ShutdownAWSLogging();
}


// fill generic args and flags from the command line arguments
void get_flags_and_args(int ac, char** av, FlagsMap& flags, ArgsVec& args)
{
    string f;
    for (int i=1; i<ac; ++i) {
        if (av[i][0] != '-') {
            // when no flag before - this is an argument
            if (f.empty()) {
                args.push_back(av[i]);
                continue;
            }
            // when flag appeared before - map it to this value
            flags[f] = av[i];
            f = "";
            continue;
        }
        // when flag appears after a flag - consume the pending flag first (no value)
        if (!f.empty() && flags[f].empty()) {
            flags[f] = "";
            f = "";
        }
        // keep the flag (either --flag or -flag are good)
        f = string(av[i]+ (av[i][1] == '-' ? 2 : 1));
        // consume the flag is of the form --flag=value
        size_t eq = f.find('=');
        if (eq != string::npos) {
            string value = f.substr(eq+1);
            f = f.substr(0, eq);
            if (!f.empty()) {
                flags[f] = value;
                f = "";
            }
        }
    }
    // consume last flag (no value)
    if (!f.empty() && flags[f].empty()) {
        flags[f] = "";
        f = "";
    }
}


// using the mime program (linux/mac) to detect mime type
string get_content_type(string fname)
{
    string cmd = string("mime ") + fname;
    FILE* pipe = popen(cmd.c_str(), "r");
    if (!pipe) return "application/octet_stream";
    char buffer[1024];
    std::string result = "";
    while (!feof(pipe)) {
        if (fgets(buffer, sizeof(buffer), pipe) != NULL) {
            result += buffer;
        }
    }
    pclose(pipe);
    size_t pos = result.find_last_not_of(" \t\n");
    if (pos != string::npos) {
        result = result.substr(0, pos+1);
    }
    return result;
}


// parsing and setting defaults for the options of this program
DemoOptions::DemoOptions(int ac, char** av) {
    FlagsMap flags;
    ArgsVec args;
    get_flags_and_args(ac, av, flags, args);

    if (args.size() != 1) {
        cerr << "Usage: " << av[0] << " [options] <filename>" << endl;
        exit(1);
    }
    fname = args[0];

    content_type = flags["content_type"];
    if (content_type.empty()) content_type = get_content_type(fname);
    if (content_type.empty()) content_type = "application/octet-stream";

    endpoint = flags["endpoint"];
    if (endpoint.empty()) endpoint = "localhost";

    bucket = flags["bucket"];
    if (bucket.empty()) bucket = "first.bucket";

    key = flags["key"];
    if (key.empty()) key = fname;

    access_key = flags["access_key"];
    if (access_key.empty()) access_key = "123";

    secret_key = flags["secret_key"];
    if (secret_key.empty()) secret_key = "abc";

    if (!flags["log"].empty()) {
        log_level = std::stoi(flags["log"]);
    } else {
        log_level = 0;
    }

    cout << "[Options]" << endl;
    cout << "fname         : " << fname << endl;
    cout << "content_type  : " << content_type << endl;
    cout << "endpoint      : " << endpoint << endl;
    cout << "bucket        : " << bucket << endl;
    cout << "key           : " << key << endl;
    cout << "access_key    : " << access_key << endl;
    cout << "secret_key    : " << secret_key << endl;
    cout << "log_level     : " << log_level << endl;
}
