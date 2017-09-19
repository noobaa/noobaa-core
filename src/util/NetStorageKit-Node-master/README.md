# NetstorageAPI: Akamai Netstorage API for Node.js

[![npm package](https://badge.fury.io/js/netstorageapi.svg)](https://badge.fury.io/js/netstorageapi)
[![Build Status](https://travis-ci.org/akamai/NetStorageKit-Node.svg?branch=master)](https://travis-ci.org/akamai/NetStorageKit-Node)
[![License](http://img.shields.io/:license-apache-blue.svg)](https://github.com/akamai/NetStorageKit-Node/blob/master/LICENSE)

[![npm package](https://nodei.co/npm/netstorageapi.png?downloads=true&downloadRank=true&stars=true)](https://nodei.co/npm/netstorageapi/)

NetstorageAPI is Akamai Netstorage (File/Object Store) API for Node.js 4.0+ with native [http module](https://nodejs.org/api/http.html).

# Table of Contents
* [Installation](#installation)
* [Example](#example)
* [Methods](#methods)
  * [delete](#delete)
  * [dir](#dir)
  * [list](#list)
  * [download](#download)
  * [du](#du)
  * [mkdir](#mkdir)
  * [mtime](#mtime)
  * [quick_delete](#quick_delete)
  * [rename](#rename)
  * [rmdir](#rmdir)
  * [stat](#stat)
  * [symlink](#symlink)
  * [upload](#upload)
* [Testing](#testing)
* [Author](#author)
* [License](#license)

# Installation

To install Netstorage API with npm global:  

```Shell
$ npm install --global netstorageapi
```

or as a development dependency for your project:
```Shell
$ npm install --save netstorageapi
```

# Example

```Javascript
const Netstorage = require('netstorageapi')

// Defaults: SSL: false
const config = {
  hostname: 'astinobj-nsu.akamaihd.net',
  keyName: 'astinobj',
  key: 'xxxxxxxxxx',
  cpCode: '407617',
  ssl: false
}
// Don't expose KEY on your public repository.

const ns = new Netstorage(config)
const local_source = 'hello.txt'

// or `/${config.cpCode}/` will asume the destination filename is the same as the source
const netstorage_destination = `/${config.cpCode}/hello.txt`

ns.upload(local_source, netstorage_destination, (error, response, body) => {
  if (error) { // errors other than http response codes
    console.log(`Got error: ${error.message}`)
  }
  if (response.statusCode == 200) {
    console.log(body)
  }
}); 

// { message: 'Request Processed.' }
```


# Methods

* [delete](#delete)
* [dir](#dir)
* [list](#list)
* [download](#download)
* [du](#du)
* [mkdir](#mkdir)
* [mtime](#mtime)
* [quick_delete](#quick_delete)
* [rename](#rename)
* [rmdir](#rmdir)
* [stat](#stat)
* [symlink](#symlink)
* [upload](#upload)

### delete
*[↑ back to method list](#methods)*
- **Syntax**: 
```Javascript 
ns.delete(NETSTORAGE_PATH, callback(err, response, body)) 
```
- **Parameters**:

	| Name        | Type        | Description                     |
	| :---------- | :---------: | :------------------------------ |
	| `NETSTORAGE_PATH` | *string* | full path for the file, not the directory |

### dir
*[↑ back to method list](#methods)*
- **Syntax**:
```Javascript
ns.dir(NETSTORAGE_PATH|OPTIONS, callback(err, response, body))
```
- **Parameters**:

	| Name        | Type        | Description                     |
	| :---------- | :---------: | :------------------------------ |
	| `NETSTORAGE_PATH` | *string* | full path for the directory |
  | `OPTIONS` | *object* | JSON object containing options for the dir method |
- **Valid Options**:
```Javascript
  { path: '/your/path', 
    actions: { 
      max_entries: integer,
      start: '/start/path',
      end: '/end/path/',
      prefix: 'object-prefix',
      slash: 'both'
    }
  }
```

### list
*[↑ back to method list](#methods)*
- **Syntax**: 
```Javascript
ns.list(NETSTORAGE_PATH|OPTIONS, callback(err, response, body))
```
- **Parameters**:

	| Name        | Type        | Description                     |
	| :---------- | :---------: | :------------------------------ |
	| `NETSTORAGE_PATH` | *string* | full path to the file/directory |
  | `OPTIONS` | *object* | JSON object containing options for the list method |
- **Valid Options**:
```Javascript
  { path: '/your/path', 
    actions: { 
      max_entries: integer,
      end: '/end/path/'
    }
  }
```

### download
*[↑ back to method list](#methods)*
- **Syntax**: 
```Javascript
ns.download(NETSTORAGE_SOURCE, LOCAL_DESTINATION, callback(err, response, body))
```
- **Parameters**:

	| Name        | Type        | Description                     |
	| :---------- | :---------: | :------------------------------ |
  | `NETSTORAGE_SOURCE` | *string* | Path to the file in NetStorage |
  | `LOCAL_DESTINATION` | *string* | Location on the local host to write the downloaded file to (Optional value) | 

### du
*[↑ back to method list](#methods)*
- **Syntax**: 
```Javascript
ns.du(NETSTORAGE_PATH, callback(err, response, body))
```
- **Parameters**:

	| Name        | Type        | Description                     |
	| :---------- | :---------: | :------------------------------ |
	| `NETSTORAGE_PATH` | *string* | full path to the file/directory |

### mkdir
*[↑ back to method list](#methods)*
- **Syntax**: 
```Javascript
ns.mkdir(DIRECTORY_NAME, callback(err, response, body))
```
- **Parameters**:

	| Name        | Type        | Description                     |
	| :---------- | :---------: | :------------------------------ |
  | `DIRECTORY_NAME` | *string* | Full path to the directory you wish to create |

### mtime
*[↑ back to method list](#methods)*
- **Syntax**: 
```Javascript
ns.mtime(NETSTORAGE_PATH, UNIX_TIME, callback(err, response, body))
```
- **Parameters**:

	| Name        | Type        | Description                     |
	| :---------- | :---------: | :------------------------------ |
	| `NETSTORAGE_PATH` | *string* | full path to the file/directory |
  | `UNIX_TIME` | integer | Unix time to set the mtime of the file to. Note that millisecond accuracy is not supported |

### quick_delete
*[↑ back to method list](#methods)*
- **Syntax**: 
```Javascript
ns.quick_delete(NETSTORAGE_DIR, callback(err, response, body)) // needs to be enabled on the CP Code
```
- **Parameters**:

	| Name        | Type        | Description                     |
	| :---------- | :---------: | :------------------------------ |
	| `NETSTORAGE_DIR` | *string* | full path to the directory you wish to delete|

### rename
*[↑ back to method list](#methods)*
- **Syntax**: 
```Javascript
ns.rename(NETSTORAGE_TARGET, NETSTORAGE_DESTINATION, callback(err, response, body))
```
- **Parameters**:

	| Name        | Type        | Description                     |
	| :---------- | :---------: | :------------------------------ |
	| `NETSTORAGE_TARGET` | *string* | full path to the original file/directory |
	| `NETSTORAGE_DESTINATION` | *string* | full path to the renamed file/directory |

### rmdir
*[↑ back to method list](#methods)*
- **Syntax**: 
```Javascript
ns.rmdir(NETSTORAGE_DIR, callback(err, response, body))
```
- **Parameters**:

	| Name        | Type        | Description                     |
	| :---------- | :---------: | :------------------------------ |
	| `NETSTORAGE_DIR` | *string* | full path to the empty object you wish to delete |

### stat
*[↑ back to method list](#methods)*
- **Syntax**: 
```Javascript
ns.stat(NETSTORAGE_PATH, callback(err, response, body))
```
- **Parameters**:

	| Name        | Type        | Description                     |
	| :---------- | :---------: | :------------------------------ |
	| `NETSTORAGE_PATH` | *string* | full path to the file/directory you wish to stat |

### symlink
*[↑ back to method list](#methods)*
- **Syntax**: 
```Javascript
ns.symlink(NETSTORAGE_TARGET, NETSTORAGE_DESTINATION, callback(err, response, body))
```
- **Parameters**:

	| Name        | Type        | Description                     |
	| :---------- | :---------: | :------------------------------ |
  | `NETSTORAGE_TARGET` | *string* | full path of the symlink to create |
  | `NETSTORAGE_DESTINATION` | *string* | full path to file to symlink to |

### upload
*[↑ back to method list](#methods)*
- **Syntax**: 
```Javascript
ns.upload(LOCAL_SOURCE, NETSTORAGE_DESTINATION, callback(err, response, body))
```
- **Parameters**:

	| Name        | Type        | Description                     |
	| :---------- | :---------: | :------------------------------ |
  | `LOCAL_SOURCE` | *string* | Path to the local file you wish to upload |
  | `NETSTORAGE_DESTINATION` | *string* | Path to the location you wish to upload the file. Note that if you omit the actual filename, the source filename is used. You may only upload files using the API, not directories. |

# Testing

Unit tests for all of the above methods are executed via the [test script](https://github.com/akamai/NetStorageKit-Node/blob/master/test/test-netstorage.js). Prior to testing, create an api-config.json file in the test directory using the provided [example](https://github.com/akamai/NetStorageKit-Node/blob/master/test/api-config.json.example) for the required values. The excellent [Mocha](https://mochajs.org/) and [ChaiJS](http://chaijs.com) libraries are used for all tests:


```Shell
$ npm install --global mocha chai
$ npm test # use test/api-config.json
```


# Author

Astin Choi (achoi@akamai.com)  

# License

Copyright 2016 Akamai Technologies, Inc.  All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
