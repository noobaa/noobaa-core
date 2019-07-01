/* Copyright (C) 2016 NooBaa */
'use strict';


try {
    process.on('uncaughtException', fail);
    process.on('unhandledRejection', fail);

    const path = require('path'); // eslint-disable-line global-require
    const AWS = require('aws-sdk'); // eslint-disable-line global-require
    const https = require('https'); // eslint-disable-line global-require

    process.once('message', msg => {

        // console.log('func_proc: received message', msg);

        if (msg.AWS_EXECUTION_ENV) process.env.AWS_EXECUTION_ENV = msg.AWS_EXECUTION_ENV;
        if (msg.aws_config) {
            if (msg.aws_config.endpoint.startsWith('https:')) {
                msg.aws_config.httpOptions = {
                    agent: new https.Agent({ rejectUnauthorized: false })
                };
            }
            AWS.config.update(msg.aws_config);
        }

        const handler_arg = msg.config.handler;
        const handler_split = handler_arg.split('.', 2);
        const module_name = handler_split[0] + '.js';
        const export_name = handler_split[1];
        // eslint-disable-next-line global-require
        const module_exports = require(path.resolve(module_name));
        const handler = export_name ?
            module_exports[export_name] :
            module_exports;

        if (typeof(handler) !== 'function') {
            fail(new Error(`Func handler not a function ${handler_arg}`));
        }

        // http://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-context.html
        const context = {
            callbackWaitsForEmptyEventLoop: false,
            functionName: '',
            functionVersion: '',
            invokedFunctionArn: '',
            memoryLimitInMB: 0,
            awsRequestId: '',
            logGroupName: '',
            logStreamName: '',
            identity: null,
            clientContext: null,
            getRemainingTimeInMillis: () => 60 * 1000, // TODO calculate timeout
        };

        if (msg.rpc_options) {
            const api = require('../../api'); // eslint-disable-line global-require
            const rpc = api.new_rpc_from_base_address(msg.rpc_options.address, 'EXTERNAL');
            const client = rpc.new_client();
            client.options = msg.rpc_options;
            context.rpc_client = client;
        }

        const callback = (err, reply) => {
            if (err) {
                console.log('func_proc: callback', err);
                if (context.callbackWaitsForEmptyEventLoop) {
                    process.on('beforeExit', () => fail(err));
                } else {
                    fail(err);
                }
                return;
            }
            // console.log('func_proc: callback reply', reply);
            if (context.callbackWaitsForEmptyEventLoop) {
                process.on('beforeExit', () => success(reply));
            } else {
                success(reply);
            }
        };

        handler(msg.event, context, callback);
    });

} catch (err) {
    fail(err);
}

function fail(err) {
    console.error('func_proc: fail', err);
    process.send({
        error: {
            message: err.message,
            code: err.code,
            stack: err.stack,
        }
    }, () => process.exit(1));
}

function success(result) {
    // console.log('func_proc: success', result);
    process.send({
        result: result
    }, () => process.exit(1));
}
