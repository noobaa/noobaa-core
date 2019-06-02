<div id="top" />
<img src="/images/noobaa_logo.png" width="200" />

----
NooBaa is a data service for cloud environments, providing S3 object-store interface with flexible tiering, mirroring, and spread placement policies, over any storage resource that allows GET/PUT including S3, GCS, Azure Blob, Filesystems, etc.

NooBaa simplifies data administration by connecting to any of the storage silos from private or public clouds, and providing a single scalable data service, using the same S3 API and management tools. NooBaa allows full control over data placement, letting you place data based on security, strategy and cost considerations, in the granularity of an application.

----

## To start using NooBaa in Kubernetes

1. Deps - use your package manager to install:

 - `kubectl`
 - `curl`
 - `openssl` (for generating random password)
 - `jq` (https://stedolan.github.io/jq/download)

2. Get script:

```bash
curl -O https://raw.githubusercontent.com/noobaa/noobaa-core/master/src/deploy/NVA_build/noobaa_deploy_k8s.sh
chmod +x noobaa_deploy_k8s.sh
```

3. Deploy - uses current kubernetes context & namespace (-n overrides current namespace):

```bash
./noobaa_deploy_k8s.sh deploy -n noobaa
```

4. Whenever you need to get NooBaa info:

```bash
./noobaa_deploy_k8s.sh info -n noobaa
```

This [youtube tutorial](http://www.youtube.com/watch?v=fuTKXBMwOes) will guide you through.

<a href="http://www.youtube.com/watch?v=fuTKXBMwOes" target="_blank">
  <img src="http://img.youtube.com/vi/fuTKXBMwOes/0.jpg"
       alt="http://www.youtube.com/watch?v=fuTKXBMwOes" 
       width="300" border="10" />
</a>


## Help

- [Website](https://www.noobaa.io)
- [Knowledge Base](https://noobaa.desk.com)
- [Wiki](https://github.com/noobaa/noobaa-core/wiki)

## Communicate

- support@noobaa.com
- [Subscribe to newsletter](https://www.noobaa.io/community)

## Contribute

- [How to Contribute](/CONTRIBUTING.md)  
- [Developers Guide](https://github.com/noobaa/noobaa-core/wiki/Developers-Guide) 

## License

Apache License 2.0, see [LICENSE](/LICENSE)
