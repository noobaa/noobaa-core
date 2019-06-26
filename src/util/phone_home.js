/* Copyright (C) 2016 NooBaa */
'use strict';

const P = require('./promise');
const url = require('url');
const dns = require('dns');
const dbg = require('./debug_module')(__filename);
const config = require('../../config.js');
const promise_utils = require('./promise_utils');
const _ = require('lodash');
const request = require('request');

function verify_connection_to_phonehome(phone_home_options, limit_conn_test) {
    let timeout_condition = _.isUndefined(limit_conn_test) ? false : !limit_conn_test;
    let parsed_url = url.parse(config.PHONE_HOME_BASE_URL);
    return promise_utils.conditional_timeout(timeout_condition, 5000,
            P.all([
                P.fromCallback(callback => dns.resolve(parsed_url.host, callback)).reflect(),
                _get_request('https://google.com').reflect(),
                _get_request(config.PHONE_HOME_BASE_URL + '/connectivity_test', phone_home_options).reflect()
            ]))
        .then(function(results) {
            var reply_status;
            let ph_dns_result = results[0];
            let google_get_result = results[1];
            let ph_get_result = results[2];
            reply_status = _handle_ph_get(ph_get_result, google_get_result, ph_dns_result);

            if (!reply_status) {
                throw new Error('Could not _verify_connection_to_phonehome');
            }

            dbg.log0('_verify_connection_to_phonehome reply_status:', reply_status);
            return reply_status;
        })
        //If T/O was caught, we did not run long test but made a best effort, don't fail the operation
        .catch(P.TimeoutError, () => 'WAS_NOT_TESTED');
}


function _get_request(dest_url, options) {
    options = options || {};
    _.defaults(options, {
        url: dest_url,
        method: 'GET',
        strictSSL: false, // means rejectUnauthorized: false
    });
    dbg.log0('Sending Get Request:', options);
    return P.fromCallback(callback => request(options, callback), {
            multiArgs: true
        })
        .spread(function(response, body) {
            dbg.log0(`Received Response From ${dest_url}`, response.statusCode);
            return {
                response: response,
                body: body
            };
        });
}


function _handle_ph_get(ph_get_result, google_get_result, ph_dns_result) {
    if (ph_get_result.isFulfilled()) {
        let ph_reply = ph_get_result.value();
        dbg.log0(`Received Response From ${config.PHONE_HOME_BASE_URL}`,
            ph_reply && ph_reply.response.statusCode, ph_reply && ph_reply.body);
        if ((_.get(ph_reply, 'response.statusCode') || 0) === 200) {
            if (String(ph_reply && ph_reply.body) === 'Phone Home Connectivity Test Passed!') {
                return 'CONNECTED';
            }
            return 'MALFORMED_RESPONSE';
            // In this case not posible to get reject unless exception
        }
        return _handle_google_get(google_get_result);
    }
    return _handle_ph_dns(ph_dns_result, google_get_result);
}


function _handle_google_get(google_get_result) {
    if (google_get_result.isFulfilled()) {
        let google_reply = google_get_result.value();
        dbg.log0('Received Response From https://google.com',
            google_reply && google_reply.response.statusCode);
        if (_.get(google_reply, 'response.statusCode', 0)
            .toString()
            .startsWith(2)) {
            return 'CANNOT_CONNECT_PHONEHOME_SERVER';
        }
    }
    return 'CANNOT_CONNECT_INTERNET';
}


function _handle_ph_dns(ph_dns_result, google_get_result) {
    if (ph_dns_result.isRejected()) {
        let dns_reply = ph_dns_result.reason();
        dbg.log0('Received Response From DNS Servers', dns_reply);

        if (dns_reply && String(dns_reply.code) === 'ENOTFOUND') {
            return 'CANNOT_RESOLVE_PHONEHOME_NAME';
        }
        return 'CANNOT_REACH_DNS_SERVER';
    }
    return _handle_google_get(google_get_result);
}

exports.verify_connection_to_phonehome = verify_connection_to_phonehome;
