/* Copyright (C) 2016 NooBaa */
/* eslint-env mongo */

'use strict';

var host;
var user;

// authenticate
db.getSiblingDB("$external").auth({
    mechanism: "MONGODB-X509",
    user: user
});

var rs_config = {
    _id: 'shard1',
    members: [{
        _id: 0,
        host: host
    }]
};

rs.initiate(rs_config);
