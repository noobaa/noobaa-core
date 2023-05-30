# S3Select Overview

Select-object-content is an s3api op to run an SQL on a stored object.
https://docs.aws.amazon.com/AmazonS3/latest/userguide/selecting-content-from-objects.html

S3Select lib is a native library that runs an SQL on a provided input.
https://github.com/ceph/s3select
For CSV and Json, S3Select supports stream parsing.
IE the input is read whole from beginning to end in chunks.
For Parquet, S3Select requires a callback for random access reading of input.

# Op Flow
There's a new op under src/endpoint/s3/ops/s3_post_object_select.js.
It starts similarly to s3_get_object, parsing params needed to get the object.
There are also select-object-content params like ScanRange and input/ouput serialization.
An "select_args" object is prepared with params needed for native layer.
An instance of the transform stream S3SelectStream is created.

# Streaming
We get the object read stream from object sdk.
This stream is piped into the S3SelectStream, and then piped into http res.
Note that read_object_stream has two versions-
1. Read Stream
If read_object_stream returns a read stream, this read stream is piped directly into S3SelectStream.
2. Async Loop
If read_object_stream works in an async loop, then read_object_stream receives S3SelectStream as a parameter.
Streaming the object into S3SelectStream is handled internally by read_object_stream.

# S3SelectStream
A transform stream that gets chunks of the object, passes them into native s3select,
and then encodes the response in AWS format.
https://docs.aws.amazon.com/AmazonS3/latest/API/RESTSelectObjectAppendix.html

It also counts the number of bytes processed for the final STAT message.

# Native S3Select
A NAPI object defined in s3select_napi.cpp.
S3SelectStream instantiates it.
It implements write() and flush().

When S3SelectStream writes a chunk to S3Select, a promise is returned.
On the S3SelectStream side, it awaits the promise to be resolved with the
result of the SQL obtained from the chunk (ie, if the chunk had content
relevant to the query).

The native implementation of write() and flush() kick-off a native async-worker.
In this worker Execute(), the chunk is (synchronically) passed to S3Select lib.
When S3Select lib returns, worker's Execute() completes.
Upon (successful) completion, In worker's OnOK(), the promise is resolved with
the SQL response.

