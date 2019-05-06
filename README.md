noobaa-core
===========

## What is NooBaa

NooBaa can collapse multiple storage silos into a single, scalable storage fabric, by its ability to virtualize any local storage, whether shared or dedicated, physical or virtual and include both private and public cloud storage, using the same S3 API and management tools. NooBaa also gives you full control over data placement, letting you place data based on security, strategy and cost considerations, in the granularity of an application.

Please see https://www.noobaa.com/ for more information.  

## Getting Help

Contacting us - support@noobaa.com

Knowledge Base - https://noobaa.desk.com/ (requires free account registration)

## How to Use NooBaa

#### Docker


#### Kubernetes

## Prerequisites

You will need  jq (json cli processor).
For Linux, you can simply run this one-liner:
```
wget -O jq https://github.com/stedolan/jq/releases/download/jq-1.6/jq-linux64;chmod +x ./jq;cp jq /usr/bin
```
## Deployment

```
wget https://raw.githubusercontent.com/noobaa/noobaa-core/master/src/deploy/NVA_build/noobaa_deploy_k8s.sh; wget https://raw.githubusercontent.com/noobaa/noobaa-core/src/deploy/NVA_build/noobaa_core.yaml;chmod +x noobaa_deploy_k8s.sh
```

```
./noobaa_deploy_k8s.sh deploy -e <youremail> -n <new namespace> -f ./noobaa_core.yaml
```

[![IMAGE ALT TEXT HERE](http://img.youtube.com/vi/hvNH9XmcYt8/0.jpg)](http://www.youtube.com/watch?v=hvNH9XmcYt8)


## Contributing Code & Submitting Issues

We are using github to host code and issues.  
  
Please refer to [How to Contribute](https://github.com/noobaa/noobaa-core/blob/master/src/deploy/CONTRIBUTING.md) for more information on how to contribute  

Please refer to [Directory Structure](https://github.com/noobaa/noobaa-core/wiki/directory-structure) for better understanding of the project's directory structure  

Please refer to [General Architecture](https://github.com/noobaa/noobaa-core/wiki/general-architecture) for better understanding of the project's architecture  

## Setting up a developer environment
Please refer to the following guides for setting up a developer environment  
[OSX](https://github.com/noobaa/noobaa-core/wiki/setup-dev-osx)  
[Linux](https://github.com/noobaa/noobaa-core/wiki/setup-dev-linux)  

To start a local environment, after following the above guides, start by installing/updating your dependencies by running
```
npm install
```
from the project root.  
This will bring the new npm deps, will build the native code and will call the gulp build task for the frontend component.  
  
Make sure mongod is running or run it manually by
```
npm run db
```  

then start the system by running each of the components on its own (if you choose this way, preferably in different shells)  
```
npm run web
npm run bg
npm run hosted_agents

sudo npm run s3
```
Note that the s3rver listens on port 80 and needs to be run with a privileged user

## Building & Testing
### Building
---MISSING BUILDING---

### Testing
The tests in the project are divided into four categories:  
 #### Unit tests
 These are tests which can ran at any location which satisfies the developer environment requirements. They do not require a NooBaa installation to run on.  
 NooBaa is using mocha as its unit test framework and they are located in src/tests/unit_tests  
 
 
 Running 
 unit tests on your code is as easy as running  
 ```
 npm test
 ```
 You can also run a single test by providing its name, for example  
 ```
 mocha src/test/unit_tests/test_semaphore.js
 ```
would run the test_semaphore unit test

#### System Tests
These are tests which involve several components or end ot end flows in the system. They require a running NooBaa system (can be a local dev system) to run on.  
They are located in src/tests/system_tests and can be run one after the other using the src/test/framework/runner component  
For example running

#### Nightly Pipeline
These are tests which ran on more complex environments, combine several flows in the system and run at higher capacities than system tests.  
They are being run each night on the latest successful build by the CI orchestration (Jenkins). They are located at src/test/qa

#### Test Utils
The tests sometimes require specific utils (manipulating agents or server status, creating certain bucket policies etc.) These utils can be found at src/test/utils

