/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * A SigV4 capture and analysis stub.
 *
 * Stands in for an S3 Tables endpoint so that real clients (PyIceberg, Spark's Iceberg
 * REST catalog, the `aws s3tables` CLI, AWS SDKs) will sign and send requests at it.
 * For every request it:
 *
 *   1. writes the raw bytes off the socket to a `.sreq` file, in the same format the
 *      signature test suite replays (src/test/unit_tests/util_functions_tests/);
 *   2. recomputes the signature under each candidate canonical-URI rule and reports
 *      which rules match the signature the client sent;
 *   3. answers just enough of the Iceberg REST and S3Tables protocols for the client
 *      to keep talking.
 *
 * Written for Spike A (which canonical path do real clients sign for a percent-encoded
 * table bucket ARN) and reusable for Spike B (what does AWS's catalog client library send).
 */

const fs = require('fs');
const os = require('os');
const url = require('url');
const http = require('http');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const AWS = require('aws-sdk');

const EMPTY_SHA256 = crypto.createHash('sha256').digest('hex');

/** Per-socket buffer of the raw bytes the client sent. */
const CAPTURE = Symbol('sigv4_capture');

const DEFAULT_ACCESS_KEY = 'AKIDEXAMPLE';
const DEFAULT_SECRET_KEY = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY';
const DEFAULT_ARN = 'arn:aws:s3tables:us-east-1:000000000000:bucket/mytables';

/**
 * Candidate canonical-URI rules. The input is the request target's path exactly as it
 * arrived on the wire - never decoded on the way in.
 * @type {Record<string, (p: string) => string>}
 */
const PATH_RULES = {
    // the wire path, untouched
    R1_raw: p => p,
    // decode each segment and escape once - an encoded slash cannot survive this
    R2_single: p => p.split('/').map(c => AWS.util.uriEscape(decodeURIComponent(c))).join('/'),
    // the AWS non-S3 rule: normalize dot and empty segments, then escape the encoded path
    R3_double_norm: p => AWS.util.uriEscapePath(path.posix.normalize(p)),
    // same, without normalization
    R4_double: p => AWS.util.uriEscapePath(p),
    // collapse %2F first, then normalize and escape
    R5_collapse: p => AWS.util.uriEscapePath(path.posix.normalize(p.replace(/%2F/g, '/'))),
    // what NooBaa computes today for every non-s3 service (signature_utils.js:205-249)
    R6_noobaa: p => AWS.util.uriEscapePath(path.normalize(decodeURI(p.replace(/%2F/g, '/')))),
    // straw man: double-encode, then restore encoded slashes as literal slashes
    R7_double_unslash: p => AWS.util.uriEscapePath(path.posix.normalize(p)).replace(/%252F/g, '%2F'),
};

/** Sort [key, value] pairs the way SigV4 orders the canonical query string. */
function compare_pairs(a, b) {
    if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
    return a[1] < b[1] ? -1 : 1;
}

/**
 * Candidate canonical-query rules, over the raw query string (no leading '?').
 * @type {Record<string, (q: string) => string>}
 */
const QUERY_RULES = {
    // sort the wire pairs verbatim, decode nothing (botocore's _canonical_query_string_url)
    Q1_passthrough: q => q.split('&')
        .filter(pair => pair !== '')
        .map(pair => {
            const i = pair.indexOf('=');
            return i < 0 ? [pair, ''] : [pair.slice(0, i), pair.slice(i + 1)];
        })
        .sort(compare_pairs)
        .map(([k, v]) => `${k}=${v}`)
        .join('&'),
    // decode then re-escape (botocore's _canonical_query_string_params)
    Q2_reencode: q => q.split('&')
        .filter(pair => pair !== '')
        .map(pair => {
            const i = pair.indexOf('=');
            const k = i < 0 ? pair : pair.slice(0, i);
            const v = i < 0 ? '' : pair.slice(i + 1);
            return [AWS.util.uriEscape(decodeURIComponent(k)), AWS.util.uriEscape(decodeURIComponent(v))];
        })
        .sort(compare_pairs)
        .map(([k, v]) => `${k}=${v}`)
        .join('&'),
    // what NooBaa computes today
    Q3_noobaa: q => AWS.util.queryParamsToString(url.parse('?' + q.replace(/%2F/g, '/'), true).query),
};

/** The `overrides.prefix` spellings the stub can hand a client, per --prefix_mode. */
const PREFIX_MODES = {
    // percent-encoded ARN - what AWS itself documents and returns
    encoded: arn => encodeURIComponent(arn),
    // the ARN verbatim, so it spans two path segments
    raw: arn => arn,
    // colons raw, the slash encoded - one segment, no colon escaping
    mixed: arn => arn.replace(/\//g, '%2F'),
    // the bare table bucket name, the permissive form of design section 3.5
    bare: arn => arn.split('/').pop(),
    // no prefix at all - the control
    none: () => undefined,
};

function main() {
    // eslint-disable-next-line global-require
    const argv = require('minimist')(process.argv.slice(2));
    if (argv.help) return print_help();

    const config = {
        port: argv.port === undefined ? 8080 : Number(argv.port),
        ssl_port: argv.ssl_port === undefined ? 0 : Number(argv.ssl_port),
        cert: argv.cert,
        key: argv.key,
        out: argv.out || path.join(os.tmpdir(), 'spikeA', 'captures'),
        client: argv.client || 'unknown',
        prefix_mode: argv.prefix_mode || 'encoded',
        arn: argv.arn || DEFAULT_ARN,
        access_key: argv.access_key || DEFAULT_ACCESS_KEY,
        secret_key: argv.secret_key || DEFAULT_SECRET_KEY,
        quiet: Boolean(argv.quiet),
    };
    if (!PREFIX_MODES[config.prefix_mode]) {
        throw new Error(`Unknown --prefix_mode ${config.prefix_mode}, expected one of ${Object.keys(PREFIX_MODES)}`);
    }
    fs.mkdirSync(config.out, { recursive: true });

    console.log('SigV4 capture server');
    console.log('  client      :', config.client);
    console.log('  prefix_mode :', config.prefix_mode, '->', PREFIX_MODES[config.prefix_mode](config.arn));
    console.log('  warehouse   :', config.arn);
    console.log('  credentials :', config.access_key, '/', config.secret_key);
    console.log('  captures    :', config.out);

    if (config.port) start_server(http.createServer(), config, config.port, 'http');
    if (config.ssl_port) {
        const opts = { cert: fs.readFileSync(config.cert), key: fs.readFileSync(config.key) };
        start_server(https.createServer(opts), config, config.ssl_port, 'https');
    }
}

function print_help() {
    console.log(`
Usage: node ${path.relative('.', __filename)} [options]

Options:
    --help                  Show this help
    --port <n>              HTTP port (default 8080, 0 to disable)
    --ssl_port <n>          HTTPS port (default disabled); needs --cert and --key
    --cert <file>           TLS certificate (openssl req -x509 -newkey rsa:2048 -nodes ...)
    --key <file>            TLS private key
    --out <dir>             Where to write .sreq captures (default $TMPDIR/spikeA/captures)
    --client <name>         Label for the captured files, e.g. pyiceberg, awscli, spark
    --prefix_mode <mode>    What to return as overrides.prefix from GET /v1/config:
                            ${Object.keys(PREFIX_MODES).join(' | ')}  (default encoded)
    --arn <arn>             Table bucket ARN the stub pretends to serve
    --access_key <ak>       Expected access key (default ${DEFAULT_ACCESS_KEY})
    --secret_key <sk>       Its secret, used to recompute signatures
    --quiet                 Only print the per-request verdict line

Captures land as <client>_<METHOD>_<t36>.sreq - the raw request bytes, byte for byte,
which is the format src/test/unit_tests/util_functions_tests/test_signature_utils.js
replays. Signing with the default credentials means a capture drops into
signature_test_suite/ with no change to that test's SECRETS map.
`);
}

function start_server(server, config, port, scheme) {
    // one request per connection, so a capture is never two requests concatenated
    server.keepAliveTimeout = 0;
    server.on(scheme === 'https' ? 'secureConnection' : 'connection', socket => {
        const chunks = [];
        socket.on('data', data => chunks.push(Buffer.from(data)));
        socket[CAPTURE] = chunks;
    });
    server.on('request', (req, res) => handle_request(req, res, config).catch(err => {
        console.error('CAPTURE SERVER ERROR', err.stack);
        if (!res.headersSent) res.writeHead(500);
        res.end();
    }));
    server.listen(port, '0.0.0.0', () => console.log(`  listening   : ${scheme}://0.0.0.0:${port}`));
}

async function handle_request(req, res, config) {
    const body = await read_body(req);
    const record = analyze(req, body, config);
    const file = write_capture(req, config);
    report(record, file, config);

    res.setHeader('Connection', 'close');
    respond(req, res, config);
}

function read_body(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', d => chunks.push(d));
        req.once('end', () => resolve(Buffer.concat(chunks)));
        req.once('error', reject);
    });
}

function write_capture(req, config) {
    const chunks = req.socket[CAPTURE];
    if (!chunks || !chunks.length) return null;
    const name = `${config.client}_${req.method}_${Date.now().toString(36)}.sreq`;
    const file = path.join(config.out, name);
    fs.writeFileSync(file, Buffer.concat(chunks));
    return file;
}

/**
 * Recompute the signature under every candidate rule and report which ones match.
 */
function analyze(req, body, config) {
    const target = req.url;
    const q_index = target.indexOf('?');
    const raw_path = q_index < 0 ? target : target.slice(0, q_index);
    const raw_query = q_index < 0 ? '' : target.slice(q_index + 1);

    const auth = parse_authorization(req.headers.authorization);
    const record = { method: req.method, target, raw_path, raw_query, auth, unsigned: !auth };
    if (!auth) return record;

    // Iceberg's Java client sends a base64 x-amz-content-sha256 but signs the hex digest,
    // so the header cannot be trusted as the payload hash - try both.
    const digest = crypto.createHash('sha256').update(body);
    const header_hash = req.headers['x-amz-content-sha256'];
    const payload_hashes = {};
    if (header_hash) payload_hashes.header = header_hash;
    payload_hashes.hex_of_body = body.length ? digest.copy().digest('hex') : EMPTY_SHA256;
    payload_hashes.base64_of_body = digest.copy().digest('base64');
    const amzdate = req.headers['x-amz-date'];
    const canonical_headers = auth.signed_headers
        .map(h => `${h}:${String(req.headers[h] ?? '').replace(/\s+/g, ' ').trim()}`)
        .join('\n');

    record.header_hash = header_hash;
    record.payload_hashes = payload_hashes;
    record.matches = [];
    record.computed = {};

    for (const [p_name, p_rule] of Object.entries(PATH_RULES)) {
        for (const [q_name, q_rule] of Object.entries(QUERY_RULES)) {
            // with no query string every query rule collapses to the empty string
            if (!raw_query && q_name !== 'Q1_passthrough') continue;
            for (const [h_name, payload_hash] of Object.entries(payload_hashes)) {
                // with an empty body every payload candidate is the same string
                if (!body.length && h_name !== 'header' && payload_hashes.header) continue;
                const canonical_uri = safe(p_rule, raw_path);
                const canonical_query = raw_query ? safe(q_rule, raw_query) : '';
                const canonical_request = [
                    req.method, canonical_uri, canonical_query,
                    canonical_headers + '\n', auth.signed_headers.join(';'), payload_hash,
                ].join('\n');
                const string_to_sign = [
                    'AWS4-HMAC-SHA256', amzdate, auth.scope,
                    crypto.createHash('sha256').update(canonical_request).digest('hex'),
                ].join('\n');
                const signature = sign(config.secret_key, auth, string_to_sign);
                const key = [p_name, raw_query && q_name, body.length && `payload=${h_name}`]
                    .filter(Boolean).join(' + ');
                record.computed[key] = { canonical_uri, canonical_query, payload_hash, signature };
                if (signature === auth.signature) record.matches.push(key);
            }
        }
    }
    return record;
}

function safe(fn, input) {
    try {
        return fn(input);
    } catch (err) {
        return `<throw: ${err.message}>`;
    }
}

function parse_authorization(header) {
    if (!header) return null;
    const match = (/^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\S+?), ?SignedHeaders=(\S+?), ?Signature=([0-9a-f]+)$/)
        .exec(header);
    if (!match) return null;
    const [, access_key, scope, signed_headers, signature] = match;
    const [date, region, service] = scope.split('/');
    return { access_key, scope, date, region, service, signature, signed_headers: signed_headers.split(';') };
}

function sign(secret_key, auth, string_to_sign) {
    const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
    let key = hmac('AWS4' + secret_key, auth.date);
    key = hmac(key, auth.region);
    key = hmac(key, auth.service);
    key = hmac(key, 'aws4_request');
    return crypto.createHmac('sha256', key).update(string_to_sign).digest('hex');
}

function report(record, file, config) {
    console.log('\n' + '='.repeat(100));
    console.log(record.method, record.target);
    if (file) console.log('  captured   :', file);
    if (record.unsigned) {
        console.log('  *** UNSIGNED REQUEST - no AWS4-HMAC-SHA256 Authorization header ***');
        console.log('  (a client whose SigV4 configuration did not take effect; do not count this run)');
        return;
    }
    const { auth } = record;
    console.log('  scope      :', auth.scope, `(service=${auth.service} region=${auth.region})`);
    if (auth.service !== 's3tables') {
        console.log(`  *** signing name is "${auth.service}", not "s3tables" ***`);
    }
    console.log('  signed hdrs:', auth.signed_headers.join(';'));
    console.log('  payload hdr:', record.header_hash);
    if (record.header_hash && !(/^[0-9a-f]{64}$/).test(record.header_hash) &&
        record.header_hash !== 'UNSIGNED-PAYLOAD') {
        console.log('  *** x-amz-content-sha256 is not a lowercase hex digest ***');
    }
    if (!config.quiet) {
        for (const [name, c] of Object.entries(record.computed)) {
            const hit = record.matches.includes(name);
            console.log(`  ${hit ? 'MATCH' : '     '} ${name.padEnd(46)} ${c.canonical_uri}${c.canonical_query ? '?' + c.canonical_query : ''}`);
        }
    }
    console.log('  VERDICT    :', record.matches.length ? record.matches.join(', ') : '*** NO RULE MATCHED ***');
}

function respond(req, res, config) {
    const q_index = req.url.indexOf('?');
    const p = q_index < 0 ? req.url : req.url.slice(0, q_index);
    const json = (code, obj) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
    };

    // ---- Iceberg REST catalog ----
    const irc = (/^(?:\/iceberg)?\/v1(\/.*)?$/).exec(p);
    if (irc) {
        const rest = irc[1] || '/';
        if (rest === '/config') {
            const prefix = PREFIX_MODES[config.prefix_mode](config.arn);
            const overrides = prefix === undefined ? {} : { prefix };
            return json(200, { defaults: {}, overrides, endpoints: [] });
        }
        if (req.method === 'HEAD') {
            res.writeHead(204);
            return res.end();
        }
        if ((/\/namespaces\/[^/]+\/tables$/).test(rest)) {
            return json(200, req.method === 'GET' ? { identifiers: [] } : iceberg_error(501, 'NotImplemented'));
        }
        if ((/\/namespaces\/[^/]+$/).test(rest)) {
            const ns = decodeURIComponent(rest.split('/').pop());
            return json(200, { namespace: ns.split(''), properties: {} });
        }
        if ((/\/namespaces$/).test(rest)) {
            if (req.method === 'GET') return json(200, { namespaces: [['default']] });
            return json(200, { namespace: ['default'], properties: {} });
        }
        return json(404, iceberg_error(404, 'NoSuchNamespaceException'));
    }

    // ---- S3Tables ----
    if ((/^\/namespaces\//).test(p)) {
        if (req.method === 'GET') return json(200, { namespaces: [] });
        return json(200, { tableBucketARN: config.arn, namespace: ['ns1'] });
    }
    if ((/^\/tables\//).test(p)) {
        if (req.method === 'GET') return json(200, { tables: [] });
        return json(200, { tableARN: `${config.arn}/table/00000000-0000-0000-0000-000000000000`, versionToken: 'v1' });
    }
    if ((/^\/buckets/).test(p)) {
        if (req.method === 'GET') return json(200, { arn: config.arn, name: config.arn.split('/').pop(), ownerAccountId: '000000000000' });
        return json(200, { arn: config.arn });
    }
    return json(404, { __type: 'NotFoundException', Message: 'capture stub: no handler' });
}

function iceberg_error(code, type) {
    return { error: { message: 'capture stub', type, code } };
}

exports.PATH_RULES = PATH_RULES;
exports.QUERY_RULES = QUERY_RULES;
exports.PREFIX_MODES = PREFIX_MODES;

if (require.main === module) main();
