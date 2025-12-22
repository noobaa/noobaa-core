#!/bin/bash

# Clone S3Select and its two submodules
./src/deploy/NVA_build/clone_submodule.sh submodules/s3select https://github.com/ceph/s3select 58875a5ee76261cc0a3d943bb168f9f9292c34a4
./src/deploy/NVA_build/clone_submodule.sh submodules/s3select/rapidjson https://github.com/Tencent/rapidjson 7c73dd7de7c4f14379b781418c6e947ad464c818
./src/deploy/NVA_build/clone_submodule.sh submodules/s3select/include/csvparser https://github.com/ben-strasser/fast-cpp-csv-parser 5a417973b4cea674a5e4a3b88a23098a2ab75479
