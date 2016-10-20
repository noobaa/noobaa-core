/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const vm = require('vm');
const yazl = require('yazl');
const yauzl = require('yauzl');
const crypto = require('crypto');

const P = require('../util/promise');

function safe_invoke(scripts, module_name, export_name, func_event) {
    const filename = module_name + '.js';
    const main_script = scripts[filename];
    const vm_require = require; // TODO sandbox require
    const vm_module = {
        // https://nodejs.org/api/modules.html
        exports: {},
        id: filename,
        filename: filename,
        parent: null,
        children: [],
        loaded: false,
        require: vm_require,
    };
    const vm_global = {
        module: vm_module,
        exports: vm_module.exports,
        setTimeout: setTimeout,
        setInterval: setInterval,
        setImmediate: setImmediate,
        clearTimeout: clearTimeout,
        clearInterval: clearInterval,
        clearImmediate: clearImmediate,
        __dirname: '',
        __filename: filename,
        require: vm_require,
        Buffer: Buffer, // TODO sandbox Buffer
        console: console, // TODO sandbox console
        process: process, // TODO sandbox process
    };
    vm_global.global = vm_global;
    main_script.runInNewContext(vm_global);
    vm_module.loaded = true;

    if (typeof(vm_module.exports[export_name]) !== 'function') {
        throw new Error('NO_SUCH_HANDLER');
    }

    // http://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-context.html
    const func_context = {
        callbackWaitsForEmptyEventLoop: true,
        functionName: '',
        functionVersion: '',
        invokedFunctionArn: '',
        memoryLimitInMB: 0,
        awsRequestId: '',
        logGroupName: '',
        logStreamName: '',
        identity: null,
        clientContext: null,
    };
    // generate a random name since we hang it on the global object
    const hidden_global_key = '__' + crypto.randomBytes(16).toString('hex');
    const hidden = {
        context: func_context,
        event: func_event,
        callback: function(err, reply) {
            hidden.err = err;
            hidden.reply = reply;
            // TODO if (!callbackWaitsForEmptyEventLoop) stop script
        }
    };
    vm_global[hidden_global_key] = hidden;
    vm.runInNewContext(`
        var func = module.exports['${export_name}'];
        var hidden = ${hidden_global_key};
        func.call(null, hidden.event, hidden.context, hidden.callback);
        `, vm_global);

    if (hidden.err) {
        console.log('err', hidden.err);
        throw hidden.err;
    } else {
        console.log('reply', hidden.reply);
        return hidden.reply;
    }
}

function zip_in_memory(files) {
    const chunks = [];
    return new P((resolve, reject) => {
            const zipfile = new yazl.ZipFile();
            zipfile.once('error', reject);
            zipfile.outputStream.on('data', chunk => chunks.push(chunk));
            zipfile.outputStream.once('error', reject);
            zipfile.outputStream.once('end', resolve);
            _.each(files, (buffer, name) => zipfile.addBuffer(buffer, name));
            zipfile.end();
        })
        .then(() => Buffer.concat(chunks));
}

function unzip_in_memory(zip_buffer) {
    const files = {};
    return P.fromCallback(callback => yauzl.fromBuffer(zip_buffer, {
            lazyEntries: true
        }, callback))
        .then(zipfile => new P((resolve, reject) => {
            zipfile.once('error', reject);
            zipfile.once('end', resolve);
            zipfile.on('entry', ent => {
                zipfile.openReadStream(ent, function(err, read_stream) {
                    if (err) return reject(err);
                    const chunks = [];
                    read_stream.on('data', chunk => chunks.push(chunk));
                    read_stream.once('error', reject);
                    read_stream.once('end', () => {
                        files[ent.fileName] = Buffer.concat(chunks);
                        zipfile.readEntry(); // read next entry
                    });
                });
            });
            zipfile.readEntry(); // start reading entries
        }))
        .return(files);
}

exports.safe_invoke = safe_invoke;
exports.zip_in_memory = zip_in_memory;
exports.unzip_in_memory = unzip_in_memory;
