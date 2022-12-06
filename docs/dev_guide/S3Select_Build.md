# How to build S3 Select

S3 Select is a native library integrated into noobaa-core.  
In noobaa-core git repository, it is present under as git submodule in /submodules/s3select (as defined in .gitmodules file).

## Local Native Build

By default, S3 Select is not build in local native default.  
This is to streamline builds of developers who don't need S3 Select feature.  
In other words, running "npm run build" and executing S3 Select code will fail.  
In order to build native locally with S3 Select, you need to:  

1. Init and clone submodule.

These git commands will fetch necessary code into your git reporosity:  
-`git submodule init (needed only once)`  
-`git submodule update (needed each update of submodule)`  
These two commands can be combined:  
`git submodule update --init`

Since S3Select has two submodules of its own, you need to repeat above commands.

All of the above can be done with:  
`git submodule update --init --recursive`

2. Install "boost-devel" package.
The "boost-devel" package is assumed to be installed by local native build.
It is a relatively widespread package, available in general package repository.
Eg, on a Fedora-based linux:
`yum install boost-devel`

3. Run build command with BUILD_S3SELECT enabled in GYP:  
`GYP_DEFINES=BUILD_S3SELECT=1 npm run build`
or, equivalently:
`GYP_DEFINES=BUILD_S3SELECT=1 node-gyp rebuild`

## Docker Build
S3Select is enabled by defualt for docker build.  
If you wish to explicitly enable/disable s3select in docker build, you can use BUILD_S3SELECT env parameter. Eg-  
`BUILD_S3SELECT=0 make noobaa NOOBAA_TAG=noobaa-core:select`

## Test Native Code
You can test native code with the provide s3select.js. Eg-  
`echo -e "1,2,3\n4,5,6" | node noobaa-core/src/tools/s3select.js --query "SELECT sum(int(_2)) from stdin;"`
Which is equivalent to-
`echo -e "1,2,3\n4,5,6" | node src/tools/s3select.js --query "SELECT sum(int(_2)) from stdin;" --input_format CSV --record_delimiter $'\n' --field_delimiter , --file_header_info IGNORE`


