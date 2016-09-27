'use strict';

const _ = require('lodash');
const vm = require('vm');
const unzip = require('unzip');

const P = require('../util/promise');

const STORED_FUNC_FIELDS = [
    'FunctionName',
    'Runtime',
    'Handler',
    'Role',
    'MemorySize',
    'Timeout',
    'Description',
];

class LambdaController {

    constructor() {
        this.stored_funcs = new Map();
    }

    create_function(req, res) {
        console.log('create_function', req.params, req.body);
        const stored_func = req.body;
        this.stored_funcs.set(stored_func.FunctionName, stored_func);
        return this._get_func_info(stored_func);
    }

    list_functions(req, res) {
        console.log('list_functions', req.params, req.body);
        const funcs = [];
        for (const stored_func of this.stored_funcs.values()) {
            funcs.push(this._get_func_info(stored_func));
        }
        return {
            Functions: funcs
        };
    }

    invoke(req, res) {
        console.log('invoke', req.params, req.body);
        const stored_func = this.stored_funcs.get(req.params.func_name);
        if (!stored_func) throw new Error('NoSuchFunction');
        const zip_data = new Buffer(stored_func.Code.ZipFile, 'base64');
        const unzipper = new unzip.Parse();
        unzipper.write(zip_data);
        return new P((resolve, reject) => {
            unzipper.on('entry', ent => {
                console.log('ZIP ENTRY', ent.path, ent.type, ent.size);
                let data = '';
                ent.setEncoding('utf8');
                ent.on('data', chunk => {
                    data += chunk;
                });
                ent.on('end', () => {
                    const code = data;
                    console.log('code', code);
                    const main = stored_func.Handler.split('.')[0];
                    if (main + '.js' !== ent.path) return;
                    const handler = stored_func.Handler.split('.')[1];
                    const vm_exports = {};
                    const vm_context = {
                        module: {
                            exports: vm_exports
                        },
                        exports: vm_exports,
                        console: console,
                    };
                    vm.runInNewContext(code, vm_context);
                    vm.runInNewContext(`
                    var func = module.exports['${handler}'];
                    var event = {};
                    var context = {};
                    func.call(null, event, context, function(err1, reply1) {
                        if (err1) {
                            err = new Error(err1);
                        } else {
                            reply = reply1;
                        }
                    });
                    `, vm_context);
                    console.log('err', vm_context.err);
                    console.log('reply', vm_context.reply);
                    if (vm_context.err) {
                        reject(vm_context.err);
                    } else {
                        resolve(vm_context.reply);
                    }
                });
            });
        });
    }

    _get_func_info(stored_func) {
        const f = _.pick(stored_func, STORED_FUNC_FIELDS);
        _.assign(f, {
            CodeSize: 246,
            FunctionArn: 'arn:aws:lambda:us-east-1:638243541865:function:guy1',
            LastModified: '2016-07-18T22:05:21.682+0000',
            CodeSha256: '+YJrd5+bVg7H4Dmr6lxAtoj4SbpHH2rRLodCGY+q+Ak=',
            Version: '$LATEST',
        });
        return f;
    }

}

module.exports = LambdaController;
