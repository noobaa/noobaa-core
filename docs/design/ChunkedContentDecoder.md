# Chunked Content Decoder

HTTP Chunked Encoding is a streaming data transfer mechanism that breaks down the data stream into a series of non-overlapping segments called "chunks".  
Each chunk is sent with its own size header, which tells the receiver how much data to expect in that chunk.  
To indicate that the data is being sent in chunks a header of `Transfer-Encoding: chunked` is included.  
Source: [HTTP Chunked Encoding](https://www.ioriver.io/terms/http-chunked-encoding)

The `ChunkedContentDecoder` class is a [Transform stream](https://nodejs.org/api/stream.html#class-streamtransform), which takes a stream that it received as chunks and streams only the data - it removes the size of the data, chunk headers of chunk-signature (optional extension), trailers, etc.

## Basic Encoding Structure:
### Chunks (Without Optional Extension and Trailers)
Each chunk consists of two parts: 
1. a header
2. the actual data.
The header is a hexadecimal number that indicates the size of the chunk in bytes, followed by a carriage return (CR) and a line feed (NL).  
The data that follows this header is exactly the size specified in the header.  
After the data, another carriage return and line feed signify the end of the chunk.  
Source: [HTTP Chunked Encoding](https://www.ioriver.io/terms/http-chunked-encoding)

```
<hex bytes of data>\r\n
<data>
...
the end of the chunk:
0\r\n
\r\n
```

Example:
```
7\r\n
Mozilla\r\n
11\r\n
Developer Network\r\n
0\r\n
\r\n
```
Source of the example: [Mozilla Transfer-Encoding](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Transfer-Encoding)


### Chunks With Optional Extension and Trailers
(combined with example)
```
1fff;chunk-signature=1a2b\r\n   - chunk header (optional extension)  
<1fff bytes of data>\r\n        - chunk data  
2fff;chunk-signature=1a2b\r\n   - chunk header (optional extension)  
<2fff bytes of data>\r\n        - chunk data  
0\r\n                           - last chunk  
<trailer>\r\n                   - optional trailer  
<trailer>\r\n                   - optional trailer  
\r\n                            - end of content  
```
Notes:
- `1fff` and `2fff` are examples of the size in hex
- trailer example: `x-amz-checksum-crc32:uOMGCw==\r\n` (key - the algorithm `crc32`, value in base64 and `\r\n` as CR NL ending of the trailer)

More info in [Wikipedia](https://en.wikipedia.org/wiki/Chunked_transfer_encoding)
And also in [RFC 7230](https://www.rfc-editor.org/rfc/rfc7230#section-4.1)

### Chunk Extension (chunk-signature)
In HTTP there is an option for adding chunk extensions, immediately following the chunk size.
```
chunk-ext      = *( ";" chunk-ext-name [ "=" chunk-ext-val ] )
```
Source: [RFC 7230](https://www.rfc-editor.org/rfc/rfc7230#section-4.1.1)

You can see in AWS SigV4 that when AWS uses the chunk extension as a chunk signature it uses it with the following structure:
```
string(IntHexBase(chunk-size)) + ";chunk-signature=" + signature + \r\n + chunk-data + \r\n                    
```
Source: [AWS Documentation Defining the Chunk Body](https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-streaming.html)

Chunk Extension are the following lines in the example encoding structure:
```
2fff;chunk-signature=1a2b\r\n   - chunk header (optional extension)  
<2fff bytes of data>\r\n        - chunk data  
```


### Trailers
In HTTP there is a option for a trailer. A trailer allows the sender to include additional fields at the end of a chunked message in order to supply metadata that might be dynamically generated while the message body is sent.  
Source: [RFC 7230](https://www.rfc-editor.org/rfc/rfc7230#section-4.1.2)


The name of the trailing is passed as a header and the trailer (key-value) passed after the chunked body. There can be added 0 or more trailers headers in a HTTP body.  
Source: [Stack OverFlow](https://stackoverflow.com/questions/5590791/http-chunked-encoding-need-an-example-of-trailer-mentioned-in-spec)

Amazon S3 supports chunked uploads that use `aws-chunked` content encoding for `PutObject` and `UploadPart` requests with trailing checksums.  

When a request has the header `x-amz-trailer` it indicates the name of the trailing header in the request. If trailing checksums exist the `x-amz-trailer` header value includes the `x-amz-checksum-` prefix and ends with the algorithm name. The following `x-amz-trailer` values are currently supported:
- x-amz-checksum-crc32
- x-amz-checksum-crc32c
- x-amz-checksum-crc64nvme
- x-amz-checksum-sha1
- x-amz-checksum-sha256

Source: [AWS Trailing Checksum Documentation](https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity.html#trailing-checksums)

Trailers are the following lines in the example encoding structure:
```
<trailer>\r\n                   - optional trailer  
<trailer>\r\n                   - optional trailer  
```

## State Machine
The chunks are passing in the buffer and the buffer is parsed in a **loop** to handle multiple chunks in the same buffer, and to handle the case where the buffer ends in the middle of a chunk.  

The `ChunkedContentDecoder` is using a state machine:
The state machine is updated according to the current state and the buffer content.
The state machine is updated by the following rules:
1. **STATE_READ_CHUNK_HEADER** - read the chunk header until CR and parse it.
2. **STATE_WAIT_NL_HEADER** - wait for NL after the chunk header.
3. **STATE_SEND_DATA** - send chunk data to the stream until chunk size bytes sent.
4. **STATE_WAIT_CR_DATA** - wait for CR after the chunk data.
5. **STATE_WAIT_NL_DATA** - wait for NL after the chunk data.
6. **STATE_READ_TRAILER** - read optional trailer until CR and save it.
7. **STATE_WAIT_NL_TRAILER** - wait for NL after non empty trailer.
8. **STATE_WAIT_NL_END** - wait for NL after the last empty trailer.
9. **STATE_CONTENT_END** - the stream is done.
10. **STATE_ERROR** - an error occurred.

The following diagram describes the changes of the state machine:
![State Machine Diagram](https://github.com/user-attachments/assets/727faf34-887a-4ad8-814c-134585618d8b)

#### Dry run for example:
An updated AWS SDK client operate `PutObject` with body: "body for example".  
On the server side we get the following buffers (showing as strings for readability):
1. "10\r\n" <- 10 hex in decimal is 16 (this is the length of the data "body for example")
2. "body for example" <- the data (we want to save as content and pipe it)
3. "\r\n0\r\n" <- CR NL of the data and "0\r\n" as completion chunk (end of data - the final object chunk)
4. "x-amz-checksum-crc32:uOMGCw==\r\n"
5. "\r\n"

In this example there are 5 calls to the parse, the whole stream has 1 data chunk and its header, 1 trailer and no chunk-signature.  
Although in this example the buffer includes the chunks inside, it doesn’t have to be like that a chunk might be split into a couple of buffers.

### Notice
Currently, we haven’t implemented the checksum on the server side, so if the request contains `x-amz-trailer: x-amz-checksum-crc32` and the railing chunk has the header name `x-amz-checksum-sha1` (instead of `x-amz-checksum-crc32`) this request would not fail.  
Example source: [AWS Trailer Chunks Documentation](https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity.html#trailing-checksums)

## Policy Change in AWS
In the past AWS supported data integrity check as an opt-in, and changed it to be by default.  
Source: [Data Integrity Protections for Amazon S3](https://docs.aws.amazon.com/sdkref/latest/guide/feature-dataintegrity.html)

Useful link about the posted message in AWS Clients:
1. [AWS CLI](https://github.com/aws/aws-cli/issues/9214)
2. [AWS SDK JS V3](https://github.com/aws/aws-sdk-js-v3/issues/6810)
3. [AWS SDK GO V2](https://github.com/aws/aws-sdk-go-v2/discussions/2960)  

They also posted a full table where this change was implemented by SDK and version [Compatibility with AWS SDKs](https://docs.aws.amazon.com/sdkref/latest/guide/feature-dataintegrity.html)  
It was also announced in [AWS blog](https://aws.amazon.com/blogs/aws/introducing-default-data-integrity-protections-for-new-objects-in-amazon-s3/)

#### WorkAround
In the past the mentioned state machine did not include states for trailers, if a request had a trailer in its body it would get to `STATE_ERROR` as the previous state machine expected the body to end with:
```
0\r\n
\r\n
```
When using an updated AWS SDK Client directly against NooBaa before the mentioned change, please run the AWS client (CLI / SDK) with the  following environment variables:
```
AWS_RESPONSE_CHECKSUM_VALIDATION=WHEN_REQUIRED
AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED
```
Source: [Data Integrity Protections for Amazon S3](https://docs.aws.amazon.com/sdkref/latest/guide/feature-dataintegrity.html)

## Code References:
### Files:
- `src/util/chunked_content_decoder.js` - the class `ChunkedContentDecoder`
- `src/test/unit_tests/jest_tests/test_chunked_content_decoder.test.js` - unit test of the class, please run with `npx jest test_chunked_content_decoder.test.js`
- `ChunkedContentDecoder_State_Machine.md` - the diagram (not as link, in case we need to modify it).

### Related PRs
1. https://github.com/noobaa/noobaa-core/pull/5397 which created the stream transformer `ChunkedContentDecoder` (the original state machine - was build with the states that handled the optional extension of aws-chunk)
2. https://github.com/noobaa/noobaa-core/pull/8753 - mainly added the trailers to the `ChunkedContentDecoder` state machine.
