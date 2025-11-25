# S3 Vectors for Noobaa

## S3 API
### Vector Buckets and Indexes

1. Needed for minimal POC - create vector bucket, create index, put vector and query vector.
2. MVP requires all get/list/delete API implemented.
1. BucketPolicy is not a must for MVP.
4. Hopefully will be able to reuse current bucket/object implementation with some adaptation.
   1. Eg add "bucket content" field to indicate whether bucket is object or vector instead of creating a new “vector bucket” entity.


## Noobaa Middle layer


1. Add an abstract VectorSDK, generally parallel to s3 api.
   1. Eg VectorSDK.create_vector_bucket(), VectorSDK.put_vector()
2. For POC - only one concrete implementation of VectorSDK translating action to LanceDB API.
	1. Will make switch to Datastax vector implementation pluggable.
3. Hopefully we might be able to skip namespace layer after initiating a LanceDB client connected to an appropriate storage. Ie client initialization will be dependent on namespace, but after that all api calls will be the same.
4. Need to translate s3 api into LanceDB api.
   1. Eg {bucket vector, index} -> table

## Backing storage
1. For s3 compatible backinstore, we can give connect a Lance client with the s3 credentials.
	1. Need to adapt provider-specific credentials (eg AWS secret key id vs. Azure account name).
2. For file system BS, we can connect LanceDB with a designated directory in file system.
3. For other usecases we can connect Lance with the Noobaa s3 endpoint.


## LanceDB
1. Has a [JS client](https://lancedb.github.io/lancedb/js/#development), which is nice.
2. For containerized, clients will probably live inside each endpoint fork. If this is deemed not feasible (or just too wasteful) we will need to run LanceDB client inside its own process/container/pod.
3. For NC, we will need a new parameter for storage directory.
4. For s3 BS, we will provide LanceDB with the s3 account, customized per s3 provider that Lance supports.
5. There will probably be some discrepancy between Lance and AWS s3 features.
	1. Eg metadata filter
6. Paid support considerations - enterpise edition? forking/ds?

