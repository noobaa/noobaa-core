/* Copyright (C) 2016 NooBaa */
/* eslint-env mongo */
'use strict';

var system = db.systems.findOne();
var replicas_chunk_config = db.chunk_configs.findOne({ 'chunk_coder_config.parity_frags': 0 });
var ec_chunk_config = db.chunk_configs.findOne({ 'chunk_coder_config.parity_frags': { $gt: 0 } });

var chunk_config;
if (system.default_chunk_config.toString() === ec_chunk_config._id.toString()) {
    chunk_config = replicas_chunk_config;
} else {
    chunk_config = ec_chunk_config;
}
printjson(chunk_config);

db.systems.updateOne({ _id: system._id }, { $set: { default_chunk_config: chunk_config._id } });
db.tiers.updateMany({ system: system._id }, { $set: { chunk_config: chunk_config._id } });

if (chunk_config === replicas_chunk_config) {
    print('EC Disabled');
} else {
    print('EC Enabled');
}
