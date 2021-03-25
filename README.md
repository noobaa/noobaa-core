[![slack](https://img.shields.io/badge/slack-noobaa-brightgreen.svg?logo=slack)](https://www.noobaa.io/community)
[![noobaa-core](https://img.shields.io/github/v/release/noobaa/noobaa-core?label=noobaa-core)](https://github.com/noobaa/noobaa-core/releases/latest)
[![noobaa-operator](https://img.shields.io/github/v/release/noobaa/noobaa-operator?label=noobaa-operator)](https://github.com/noobaa/noobaa-operator/releases/latest)
<div id="top"></div>
<img src="/images/noobaa_logo.png" width="200" />

----
NooBaa is a data service for cloud environments, providing S3 object-store interface with flexible tiering, mirroring, and spread placement policies, over any storage resource that allows GET/PUT including S3, GCS, Azure Blob, Filesystems, etc.

NooBaa simplifies data administration by connecting to any of the storage silos from private or public clouds, and providing a single scalable data service, using the same S3 API and management tools. NooBaa allows full control over data placement, letting you place data based on security, strategy and cost considerations, in the granularity of an application.

----

## Deploy to Kubernetes

To deploy NooBaa, we recommend using NooBaa CLI.
Follow the instructions in https://github.com/noobaa/noobaa-operator#noobaa-operator 

Once NooBaa CLI installed, simply Install the operator and noobaa with: 
```
./noobaa install
```
The install output includes S3 service endpoint and credentials, as well as web management console address with credentials.

Getting this information is always available with: 
```
./noobaa status
```
Remove NooBaa deployment can be done with: 
```
./noobaa uninstall
```

## Tutorial

[![YOUTUBE](https://img.youtube.com/vi/QXr2pSL3AVY/0.jpg)](https://www.youtube.com/watch?v=QXr2pSL3AVY)

(Click the image or the link to open the [noobaa install demo on YouTube](https://www.youtube.com/watch?v=QXr2pSL3AVY))


## Help

- [Website](https://www.noobaa.io)
- [Wiki](https://github.com/noobaa/noobaa-core/wiki) - articles for hackers
- [Docs](https://noobaa.github.io) - the new docs site is almost ready...

## Communicate

- support@noobaa.com
- [Subscribe to newsletter](https://www.noobaa.io/community)

## Contribute

- [How to Contribute](/CONTRIBUTING.md)  
- [Developers Guide](https://github.com/noobaa/noobaa-core/wiki/Developers-Guide) 

## License

Apache License 2.0, see [LICENSE](/LICENSE)
