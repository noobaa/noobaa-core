noobaa-core
===========

## What is NooBaa

NooBaa can collapse multiple storage silos into a single, scalable storage fabric, by its ability to virtualize any local storage, whether shared or dedicated, physical or virtual and include both private and public cloud storage, using the same S3 API and management tools. NooBaa also gives you full control over data placement, letting you place data based on security, strategy and cost considerations, in the granularity of an application.

Please see https://www.noobaa.com/ for more information.  

## Getting Help

Contacting us - support@noobaa.com

Knowledge Base - https://noobaa.desk.com/ (requires free account registration)

## How to Use NooBaa

### Kubernetes

#### Prerequisites

You will need  jq (json cli processor).
For Linux, you can simply run this one-liner:
```
wget -O jq https://github.com/stedolan/jq/releases/download/jq-1.6/jq-linux64;chmod +x ./jq;cp jq /usr/bin
```
#### Deployment

```
wget https://raw.githubusercontent.com/noobaa/noobaa-core/master/src/deploy/NVA_build/noobaa_deploy_k8s.sh; wget https://raw.githubusercontent.com/noobaa/noobaa-core/src/deploy/NVA_build/noobaa_core.yaml;chmod +x noobaa_deploy_k8s.sh
```

```
./noobaa_deploy_k8s.sh deploy -e <youremail> -n <new namespace> -f ./noobaa_core.yaml
```

##### Deployment Video
[![IMAGE ALT TEXT HERE](http://img.youtube.com/vi/Rkig1lZccns/0.jpg)](https://youtu.be/Rkig1lZccns)


## Join NooBaa's open community

Subscribe to NooBaa's open community https://www.noobaa.com/community

## Contributing Code & Submitting Issues

We are using github to host code and issues.  
  
Please refer to [How to Contribute](https://github.com/noobaa/noobaa-core/blob/master/CONTRIBUTING.md) for more information on how to contribute  

Please refer to [Directory Structure](https://github.com/noobaa/noobaa-core/wiki/directory-structure) for better understanding of the project's directory structure  

Please refer to [Developers Guide](https://github.com/noobaa/noobaa-core/wiki/Developers-Guide) for better understanding of the project's architecture  
