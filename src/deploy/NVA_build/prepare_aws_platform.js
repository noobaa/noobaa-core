/* Copyright (C) 2016 NooBaa */
'use strict';


const request = require('request');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);

const dotenv = require('../../util/dotenv');
dotenv.load();


function get_instance_md() {
    if (process.env.PLATFORM !== 'aws') return;
    return P.retry({
            attempts: 10,
            delay_ms: 30000,
            func: async () => {
                try {
                    const res = await P.fromCallback(callback => request({
                        method: 'GET',
                        url: 'http://169.254.169.254/latest/dynamic/instance-identity/document',
                    }, callback));

                    dbg.log0('got res from AWS md service. body=', res.body);
                    const { marketplaceProductCodes, instanceId, region } = JSON.parse(res.body);
                    if (!region || !instanceId) {
                        throw new Error('must have region and instanceId');
                    }
                    const product_key = marketplaceProductCodes && marketplaceProductCodes.length ? marketplaceProductCodes[0] : '1etpchki9tt3cug6esogoyq1k';
                    dotenv.set({
                        key: 'AWS_PRODUCT_CODE',
                        value: product_key
                    });
                    dotenv.set({
                        key: 'AWS_REGION',
                        value: region
                    });
                    dotenv.set({
                        key: 'AWS_INSTANCE_ID',
                        value: instanceId
                    });
                } catch (err) {
                    dbg.error('got error when trying to get data from instance md service:', err);
                    throw err;
                }
            }
        })
        .catch(err => {
            dbg.error('FAILED GETTING AWS INSTANCE MD', err);
            throw err;
        });
}

P.resolve()
    .then(() => get_instance_md())
    .then(() => process.exit(0), () => process.exit(1));
