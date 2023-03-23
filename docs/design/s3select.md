
# S3 Select


## Goal

Provide a feature to run S3 Select queries as close as possible to AWS feature.


## Scenarios

A client sends an S3 Select request according to AWS specification (see [SelectObjectContent - Amazon Simple Storage Service](https://docs.aws.amazon.com/AmazonS3/latest/API/API_SelectObjectContent.html)).

The endpoint will retrieve the relevant file (AKA key), process the query, and reply according to specification (see [Appendix: SelectObjectContent Response - Amazon Simple Storage Service](https://docs.aws.amazon.com/AmazonS3/latest/API/RESTSelectObjectAppendix.html)).


## Technical Details


### Query Processing Implementation

Use external implementation, as implementing in-house is not a valid option.



* S3Select ([https://github.com/ceph/s3select](https://github.com/ceph/s3select)) implements running SQL on character stream in C++. This requires napi, git and build changes. This is the chosen implementation.
* Partiql ([https://partiql.org/](https://partiql.org/)) is available only in Kotlin implementation. This requires starting a JVM in the endpoint to process SQL, which is cumbersome.
    * [https://github.com/partiql/partiql-lang-rust](https://github.com/partiql/partiql-lang-rust) can be considered in the future, but for now it doesn’t have a full implementation yet.


### New S3 OP

A new s3 op, post_object_select will be added.

There are two variations of files to consider:



1. csv, json - These are “stream-friendly”, they are read once from start to finish. So we can get their stream like standard get_object s3 op, pipe the stream to s3select to process, and pipe the result to http res object.
2. Parquet
    1. Processing a parquet file requires random seeking. In other words, at any time during the processing of the SQL, s3select can require to read any address of the file. So the stream-piping is not suitable.
    2. A general, currently undesigned, solution is to channel the request upwards, back to a callback in post_object_select, which will ask object_sdk for the required address and send it back to s3select.
    3. In the simple case of FS namespace buckets, if the required file resides in the endpoint host, the file path (rather than stream) can be sent to s3select for processing. This allows processing Parquet files stored in namespace buckets.
    4. Parquet requires Arrow, a library for processing Parquet files.
    5. Initial feature will not support Parquet.
    6. Currently Parquet is only supported to NSFS, where seeking a file is easy.

### HTTP Response

Response should conform to specification (see [Appendix: SelectObjectContent Response - Amazon Simple Storage Service](https://docs.aws.amazon.com/AmazonS3/latest/API/RESTSelectObjectAppendix.html)).

We can adapt S3Select example code that already has implementation to add crc and headers for each chunk.


### Napi

New native code that will implement a transform stream (similar to coder/chunker). This stream will have these functions:



* write(byte array) - that will reply with rows matching the query.
* flush() - that will reply with SQL-aggregate (eg count, sum) result.

Preferably, stream will not encode/decode bytes into/from strings and will not copy buffers.


### Git and Build



1. S3Select source

S3Select is a git repository. It has 3 dependencies:



* Fast Cpp Csv Parser ([https://github.com/ben-strasser/fast-cpp-csv-parser](https://github.com/ben-strasser/fast-cpp-csv-parser))
* RapidJson parser ([https://github.com/Tencent/rapidjson](https://github.com/Tencent/rapidjson))
* Boost

The parser git repositories which are submodules of s3select repository.

Boost is assumed by s3select make to be installed on the builder machine.

For Parquet, Arrow (and its dependencies) are assumed to be installed.

2. noobaa-core repository

In noobaa-core repository, a new submodules directory and .gitmodules file are added.

It will have the s3select and boost repositories as submodules, and the two parsers recursively, inside the s3select submodule.



3. Docker build

In docker build, these repositories are fetched and node-gyp uses the sources for compilation.

Only necessary Boost submodules are fetched.

All repositories are checkout to a specific commit/tag so updates won’t affect us directly.

When updates are needed, the checkout command needs to be updated to a new commit/tag.

Parquet is not build by default.

4. Native build

Running native build should still be possible.

Git submodules are needed to be fetched manually (once).


### Tests



* S3 ceph tests
* ..


### Upstream Docs

