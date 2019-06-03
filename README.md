<div id="top" />
<img src="/images/noobaa_logo.png" width="200" />

----
NooBaa is a data service for cloud environments, providing S3 object-store interface with flexible tiering, mirroring, and spread placement policies, over any storage resource that allows GET/PUT including S3, GCS, Azure Blob, Filesystems, etc.

NooBaa simplifies data administration by connecting to any of the storage silos from private or public clouds, and providing a single scalable data service, using the same S3 API and management tools. NooBaa allows full control over data placement, letting you place data based on security, strategy and cost considerations, in the granularity of an application.

----

## Deploy to Kubernetes

To deploy run the following commands:

```bash
curl -O https://raw.githubusercontent.com/noobaa/noobaa-core/master/src/deploy/NVA_build/noobaa_deploy_k8s.sh
chmod +x noobaa_deploy_k8s.sh
./noobaa_deploy_k8s.sh deploy -n noobaa
```

NOTE: check that you have these tools installed in your package manager (brew/yum/apt/etc):
 - `kubectl`
 - `curl`
 - `openssl`
 - `jq` - https://stedolan.github.io/jq/download


## Tutorials

[![asciicast](https://asciinema.org/a/kCziF0feQD9qmNioLUSAZNoEm.svg)](https://asciinema.org/a/kCziF0feQD9qmNioLUSAZNoEm?speed=2&autoplay=1)

[NooBaa From Zero to Multi Cloud on youtube](https://youtu.be/fuTKXBMwOes)

[![Watch the video](https://img.youtube.com/vi/fuTKXBMwOes/default.jpg)](https://youtu.be/fuTKXBMwOes)

## Help

- [Website](https://www.noobaa.io)
- [Knowledge Base](https://noobaa.desk.com) - articles for specific user tasks
- [Wiki](https://github.com/noobaa/noobaa-core/wiki) - articles for hackers

## Communicate

- support@noobaa.com
- [Subscribe to newsletter](https://www.noobaa.io/community)

## Contribute

- [How to Contribute](/CONTRIBUTING.md)  
- [Developers Guide](https://github.com/noobaa/noobaa-core/wiki/Developers-Guide) 

## License

Apache License 2.0, see [LICENSE](/LICENSE)
