# S3 Vectors for Noobaa

## S3 API
### Vector Buckets and Indexes

1. Needed for minimal POC - create vector bucket, create index, put vector and query vector.
2. MVP requires all get/list/delete API implemented.
1. BucketPolicy is not a must for MVP.
4. Hopefully will be able to reuse current bucket/object implementation with some adaptation.
   1. Eg add "bucket content" field to indicate whether bucket is object or vector instead of creating a new “vector bucket” entity.

### Terminology
#### AWS S3 Vectors
As part of their S3 offering, AWS implements API for interacting with vectors.
This includes creating a "vector bucket", which contains "indexes".
Vectors can be inserted into indexes, and then queried to get a list of vectors closest to query vector.
More in
https://aws.amazon.com/s3/features/vectors/
https://docs.aws.amazon.com/AmazonS3/latest/API/API_Operations_Amazon_S3_Vectors.html

#### LanceDB
Lance is an DB designed for vectors.
It stores vectors in tables, which can be queried.
Lance can store its internal DB files in either on of two storage backends
-A dedicated directory in a filesystem
-A dedicated object bucket in several providers (AWS, Azure, etc).
More in https://lancedb.com/

#### Conflicting Terminology S3 vs. Lance
AWS S3 vectors and lance have the use the same term with different meaning.
In AWS: a "Vector Bucket" hold several "Indexes". An "Index" holds several vectors.
In Lance: a "Table" holds several vectors. An "Index" is created on data to accelerate search, similar to RDBM index.
Lance does not have the concept of "Bucket", S3 vectors does not have the concept of "Table".

In the following description of S3 vectors api design, whenever "Bucket" or "Index" is referred, it should be explicitly mention whether it refers to the AWS or Lance meaning.

#### Noobaa Terminology
This document will refer to some Noobaa-related concept, such as:

Bucketspace - How Noobaa stores information about buckets. There's a single bucketspace in a Noobasystem.
Noobaa Bucketpace - Each bucket is stored as a row in a table in Postgres RDBMS.
Filesystem Bucketspace - Each bucket is stored as a json file in a dedicated directory.

Namespace - How Noobaa stores content of object internally.
Noobaa Namespace - Object content is chunked and can be stored in several tiers in several backing stores.
Name Namespace - Each object content is stored in a single file.
More in https://github.com/noobaa/noobaa-core/blob/master/docs/bucket-types.md

Backingstore - A place that store arbitrary blob-like data, either S3-compatible object storage, or a filesystem.

### Architecture

```mermaid
flowchart TD
    A1[RAG]
    A2[Inference/Agent]
    B[S3 Vector Endpoint]
    B1[BucketSpace]
    C{{Vector Plugin System}}
    D1[LanceDB Plugin]
    D2[LanceDB API]
    E1[TBD... e.g. OpenSearch Plugin]
    E2[TBD... e.g. OpenSearch Vector API]
    F[FS Backend]
    G[S3 Backend]
    
    A2-->|Query|B
    A1-->|Ingest|B
    B-->C
    B-->|Bucket configs and policies|B1
    C-->D1
    C-->E1
    D1-->D2
    D2-->F
    D2-->G
    E1-->E2
    E2-.->F
    E2-.->G
```

### Vector Bucket

#### Create
https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_CreateVectorBucket.html

This is a NOP for Lance implementation.
Lance requires either an explicit schema or a specific vector in order to create a table.

For NB bucketspace, insert a new row in the VectorBuckets DB table.

For FS bucketspace, create a new json file in the vector_buckets table.

Currently only "vectorBucketName" is used. "encryptionConfiguration" and "tags" are ignored.

Returns the new bucket's ARN.

#### Get
https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_GetVectorBucket.html

Returns bucket information according to the relevant bucketspace.

#### List
https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_ListVectorBuckets.html

Returns relevant data according to the relevant bucketspace.
"prefix" and "maxResults" are honored and should propagate to the bucketspace level to accelerate handling.
Pagination with "nextToken" is not currently implemented. Evaluating ROI of implementing it should be evaluated at a later stage.

#### Delete
https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_DeleteVectorBucket.html

Shall propagate delete request to relevant bucketspace.
NB shall add "deleted" field to the relevant db row.
FS shall delete the relevant json file.

For NB, actual deletion will be implemeted in standard "DB Cleaner" BG worker.

### Vector

#### Put
https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_PutVectors.html

In Lance:
-Translate vector format from aws to lance. 
-Try to get the table:
--If table does not exist, create it with the given vectors
--Otherwise just insert vectors into table.

#### List
https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_ListVectors.html

In Lance:
-create a Lance query.
-add maxResults as limit to Lance query.
-execute query
-translate vectors format from Lance to aws. Add data or metadata as necessary.

Currently without segments (pagination).

#### Query
https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_QueryVectors.html

In Lance:
-create a Lance query with the query vector.
-add topK as limit, if present.
-execute query
-translate vector format from Lance to aws

#### Delete
https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_DeleteVectors.html

In Lance:
-translate keys into Lance "ids in" filter.
-execute delete

### Index
In Lance case, the technical difficulty here is to translate find a place for the Lance parameters in the AWS request body type.
Since 
-Lance index and S3 vectors index are essentially different AND
-S3 vectors' CreateIndex request type is restricted,
we can utilize the generic Tags field to put all data.

https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_CreateIndex.html
https://lancedb.github.io/lancedb/js/interfaces/IndexOptions/

Other than that, Index API is a simple CRUD.

### Tags

We can support all of the simple Add/List/Remove tags for vector buckets using in the Bucketspace levels.
For NB, we will add a field 'Tags' in the DB schema of a vector bucket.
Similarly, for FS, we will add a 'Tags' field for the json schema of the vector bucket.
API is a simple CRUD.

### Policy

Will be added as a field 'Policy' of its own schema into vector bucket schema, in both FS and NS case.
Enforcing a policy will be done in vector_rest layer, similarly to S3 bucket schemas.
API is simple CRUD.

## Rest API layer

### Vector REST
As a first layer of handling a vector request, this new http listener will read, parse, validate, authenticate, send down to op handler, and write out result (if any).
Essentially similar to existing s3/iam/sts REST listeners, with different OP handlers.
Particularities of vectors api should be handled here, specifically lack of body's sha256 header, and URL parsing (ie how to get op and vector bucket name from URL).
The endpoint will register this new https listener.
The operator will publish a new endpoint and service.

### Op Handling
#### Op Handler
Each AWS S3 vectors api action listed in
https://docs.aws.amazon.com/AmazonS3/latest/API/API_Operations_Amazon_S3_Vectors.html
that we decide to support shall have a corresponding OP handler to handle it.
An OP handler is supposed to be a thin layer translating HTTP req parameters into an object_sdk method.

#### VectorSDK
A new layer "VectorSDK" shall be added to mediate between Op handlers and vector plugins and bucketspaces.
Conceptually similar to ObjectSDK, paralleling vectors to objects.

VectorSDK shall propagate request to either one or both of-
1. Relevant Bucketspace
2. VectorUtils

#### VectorUtils
VectorUtils shall determine the VectorPlugin used to handle the request.
VectorPlugins instances shall be stored in an LRU cache, creating and connecting a new connection lazily.
VectorUtils shall propagate request to a connected VectorPlugin.

#### VectorPlugin
VectorPlugin is abstract, with a concrete implementation per vector backend (Lance, Davinci, etc).
VectorPlugin translates parameters to vector backend api and calls appropriate apis on vector backend client.

## BackingStorage/Storage?/VectorStorage?
### CRDs
We need to specify, at least in Lance client case, two kinds of independent parameters:
-A storage connection - Can be an S3 account (endpoint url, secret id, secret key), or a FS based.
This can be the alread-existing CRDs Backingstore and NamespaceStore.
For FS we can also use a pvc directly, without NamespaceStore?

-A path withing the storage. For S3 this is an object bucket name. For FS it's a path withing the FS.

A vector bucket can use any combination of the two, eg
-Vector bucket VB1 uses NamespaceStore NS1 with directory /vectors1.
-Vector bucket VB2 uses NS1 with directory /vectors2.
-Vector bucket VB3 uses AWS s3 connection S31 with object bucket OB1.
-Vector bucket VB4 uses AWS s3 connection S32 with object bucket OB2.
-Vector bucket VB5 that uses NS1 and /path1 is essentially equivalent to VB1 (at least in Lance case).

### Bucket-VectorStorage Relation
Need to specify how a vector bucket relates to a vector backend. Some options:

1. Pure s3-compatible: repurpose "tags" parameter of s3 vector bucket creation action to state desired VectorStorage and path.
Eg, {
   "tags": {
      "vectorStorage" : "NS1",
      "vectorStoragePath": "/vectors1"
   },
   "vectorBucketName": "VB1"
}

2. Use account-level default (similar to account's default resource).
This enables account-level granularity control.
Can be combine as a default fall-back with above "Pure s3-compatible" option.

3. New actions in cli (similar to OB in ODF, manage_nsfs in NSFS). Allows control on parameter names and values. Eg
nb vector-bucket create vector-storage=NS1 vectorStoragePath='/vectors1'

