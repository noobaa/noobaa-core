<div id="top" />
<img src="/images/noobaa_logo.png" width="200" />

----
NooBaa is a data service for cloud environments, providing S3 object-store interface with flexible tiering, mirroring, and spread placement policies, over any storage resource that allows GET/PUT including S3, GCS, Azure Blob, Filesystems, etc.

NooBaa simplifies data administration by connecting to any of the storage silos from private or public clouds, and providing a single scalable data service, using the same S3 API and management tools. NooBaa allows full control over data placement, letting you place data based on security, strategy and cost considerations, in the granularity of an application.

----

## To start using NooBaa in Kubernetes

Follow this [video tutorial](http://www.youtube.com/watch?v=fuTKXBMwOes)

<a href="http://www.youtube.com/watch?v=fuTKXBMwOes" target="_blank">
  <img src="http://img.youtube.com/vi/fuTKXBMwOes/0.jpg"
       alt="http://www.youtube.com/watch?v=fuTKXBMwOes" 
       width="300" border="10" />
</a>

Here are the tutorial steps for copy-pasta:

1. Install `jq` (json cli tool needed for our bash script):  
Use your package manager as described in https://stedolan.github.io/jq/download
For example `sudo apt-get install jq` or `sudo yum install jq` or `brew install jq` (for Mac) or just hack it for linux with:
```bash
wget -O jq https://github.com/stedolan/jq/releases/download/jq-1.6/jq-linux64
chmod +x jq
mv jq /usr/local/bin/
```
2. Get deploy files:
```bash
wget https://raw.githubusercontent.com/noobaa/noobaa-core/master/src/deploy/NVA_build/noobaa_deploy_k8s.sh
wget https://raw.githubusercontent.com/noobaa/noobaa-core/master/src/deploy/NVA_build/noobaa_core.yaml
chmod +x noobaa_deploy_k8s.sh
```
3. Deploy to current kubernetes context:
```bash
./noobaa_deploy_k8s.sh deploy -e <youremail> -n <namespace> -f noobaa_core.yaml
```
4. Get info on NooBaa deployment (on current kubernetes context):
```bash
./noobaa_deploy_k8s.sh info -n <namespace>
```

## Help

- [Website](https://www.noobaa.com)
- [Knowledge Base](https://noobaa.desk.com)
- [Wiki](https://github.com/noobaa/noobaa-core/wiki)

## Communicate

- support@noobaa.com
- [Subscribe to newsletter](https://www.noobaa.com/community)

## Contribute

- [How to Contribute](/CONTRIBUTING.md)  
- [Developers Guide](https://github.com/noobaa/noobaa-core/wiki/Developers-Guide) 

## License

Apache License 2.0, see [LICENSE](/LICENSE)
