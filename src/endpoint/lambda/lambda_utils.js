/* Copyright (C) 2016 NooBaa */
'use strict';

function get_func_config(info) {
    return {
        FunctionName: info.config.name,
        Version: info.config.version || '$LATEST',
        Runtime: info.config.runtime,
        Handler: info.config.handler,
        Role: info.config.role,
        MemorySize: info.config.memory_size,
        Timeout: info.config.timeout,
        Description: info.config.description,
        CodeSize: info.config.code_size,
        CodeSha256: info.config.code_sha256,
        LastModified: new Date(info.config.last_modified).toISOString(),
        FunctionArn: info.config.resource_name,
        VpcConfig: {
            SubnetIds: info.config.pools
        }
    };
}

exports.get_func_config = get_func_config;
