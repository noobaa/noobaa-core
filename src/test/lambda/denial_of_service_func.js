/* Copyright (C) 2016 NooBaa */
'use strict';

const AWS = require('aws-sdk');

exports.handler = function(event, context, callback) {
    const start = Date.now();
    const end = start + event.time;
    let num_calls = 0;
    let num_errors = 0;
    let took = 0;
    const lambda = new AWS.Lambda(event.lambda_conf);

    for (let i = 0; i < event.concur; ++i) {
        worker();
    }

    function worker() {
        const now = Date.now();
        if (now >= end) {
            return callback(null, {
                num_calls: num_calls,
                num_errors: num_errors,
                took: took,
            });
        }
        num_calls += 1;
        lambda.invoke({
            FunctionName: event.func_name,
            Payload: JSON.stringify(event.func_event),
        }, function(err, res) {
            if (err) {
                num_errors += 1;
            } else {
                took += Date.now() - now;
            }
            setImmediate(worker);
        });
    }
};
