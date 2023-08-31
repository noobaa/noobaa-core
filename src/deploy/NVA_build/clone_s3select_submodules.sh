#Clone S3Select and its two submodules, but only if BUILD_S3SELECT=1.
./src/deploy/NVA_build/clone_submodule.sh submodules/s3select https://github.com/ceph/s3select 58875a5ee76261cc0a3d943bb168f9f9292c34a4 BUILD_S3SELECT
./src/deploy/NVA_build/clone_submodule.sh submodules/s3select/rapidjson https://github.com/Tencent/rapidjson fcb23c2dbf561ec0798529be4f66394d3e4996d8 BUILD_S3SELECT
./src/deploy/NVA_build/clone_submodule.sh submodules/s3select/include/csvparser https://github.com/ben-strasser/fast-cpp-csv-parser 5a417973b4cea674a5e4a3b88a23098a2ab75479 BUILD_S3SELECT

