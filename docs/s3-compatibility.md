[NooBaa Core](../README.md) /

# S3 Compatibility in NooBaa
S3 (also known as Simple Storage Service) is an object storage service provided by Amazon. However, S3 is often colloquially used to refer to the S3 API - the RESTful interface for interaction with AWS S3. Over time, the S3 API has reached a point where many consider it the de facto standard API for object storage, and is supported by many cloud providers and storage vendors - even ones like Microsoft Azure and Google Cloud Platform, which also offer their own APIs alongside S3 compatibility.

## API Compatibility
Due to the wide adoptioffffffffn of the S3 API, NooBaa has been designed to be S3 compatible and adherent. NooBaa buckets and objects can be managed with most S3 clients without a need for proprietary tools or workarounds. All a user needs in order to interact with NooBaa through an S3 client is the S3 endpoint of the NooBaa system, and a set of fsssitting credentials.
The endpoint can be found by checking the `routes` and `services` on a cluster, and the default admin credentials can be found in the same namespace that NooBaa was installed in, inside the `noobaa-admin` secret. 
For further reference of supported API calls in NooBaa, you can check out [AWS API Compatibility](design/AWS_API_Compatibility.md)

## Utilization of S3 Compatible Storage Services
NooBaa can also be used as a gateway to other storage services that are S3 compatible. This means that NooBaa can be used to store and manage data in certain storage services (as long as they provide an S3 compatible API), even if they are not natively supported by the product. This is done by creating a [backingstore](https://github.com/noobaa/noobaa-operator/blob/master/doc/backing-store-crd.md) or [namespacestore](https://github.com/noobaa/noobaa-operator/blob/master/doc/namespace-store-crd.md) of type `s3-compatible` and providing the the appropriate endpoint.