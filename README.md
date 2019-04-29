noobaa-core
===========

---MISSING---
Please see https://www.noobaa.com/ for more information.  

## Contributing Code & Submitting Issues

We are using github to host code and issues.  
  
Please refer to [How to Contribute](https://github.com/noobaa/noobaa-core/blob/master/src/deploy/CONTRIBUTING.md) for more information on how to contribute  

Please refer to [Directory Structure](https://github.com/noobaa/noobaa-core/wiki/directory-structure) for better understanding of the project's directory structure  

Please refer to [General Architecture](https://github.com/noobaa/noobaa-core/wiki/general-architecture) for better understanding of the project's architecture  

## Setting up a developer environment
Please refer to the following guides for setting up a developer environment  
[OSX](https://github.com/noobaa/noobaa-core/wiki/setup-dev-osx)  
[Linux](https://github.com/noobaa/noobaa-core/wiki/setup-dev-linux)  

To start a local enviroment, after following the above guides, start by installing/updating your dependencies by runnning
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
Note that the s3rver listens on port 80 and needs to be run with a privilaged user

## Building & Testing
### Building
---MISSING BUILDING---

### Testing
The tests in the project are divided into three categories:  
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
These are tests which involve several components or end ot end flows in the system. They require a running NooBaa system (can be a locla dev system) to run on.  
They are located in src/tests/system_tests and can be run one after the other using the src/test/framework/runner component  
For example running

#### Nightly Pipeline
These are tests which ran on more complex environments, combine several flows in the system and run at higher capacities than system tests.  
They are being run each night on the latest successful build by the CI orchestration (Jenkins). They are located at src/test/qa

#### Test Utils
The tests sometimes require specific utils (manupulating agents or server status, creating certain bucket policies etc.) These utils can be foind at src/test/utils

