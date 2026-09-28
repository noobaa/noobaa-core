/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * A stateful Amazon S3 Tables control-plane stub.
 *
 * Spike A's `sigv4_capture_server.js` answers with canned JSON, which is enough to make a
 * client sign one request and go away. Spike B has to carry a client further than that:
 * AWS's S3 Tables catalog library creates a table, writes a `metadata.json` through
 * S3FileIO and then commits it, and every step reads state the previous step wrote. So this
 * stub keeps namespaces and tables in memory, issues real version tokens and enforces them.
 *
 * It reuses spike A's listener, raw-byte capture and signature analysis, and supplies only
 * the protocol answers. Every request is still written as a `.sreq` fixture, and every
 * state change is appended to a JSONL journal, so a run is reproducible from its artifacts.
 *
 * What the spike measures, and therefore what is configurable here:
 *
 *   --warehouse_base   the backing-bucket URL the server assigns table locations under
 *   --trailing_slash   whether the assigned `warehouseLocation` ends in '/'
 *
 * Design section 3.3 writes the assigned location with a trailing '/'; Iceberg
 * conventionally stores `location` without one. Section 6.1.4 compares the document's
 * `location` with the assigned one literally, so which spelling the library round-trips
 * decides whether that comparison can stay literal. Running the same scenario under both
 * settings is the measurement (design section 15).
 *
 * Usage:
 *
 *   node src/tools/s3tables_stub_server.js --port 8080 \
 *        --warehouse_base s3://mytables--table-s3-nb --trailing_slash on \
 *        --client awscatalog --out /tmp/spikeB/captures
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const capture = require('./sigv4_capture_server');

/** Operations the S3 Tables API models but this stub does not need. */
const NOT_IMPLEMENTED = 'the spike stub does not implement this operation';

function main() {
    // eslint-disable-next-line global-require
    const argv = require('minimist')(process.argv.slice(2));
    if (argv.help) return print_help();

    const config = {
        port: argv.port === undefined ? 8080 : Number(argv.port),
        ssl_port: argv.ssl_port === undefined ? 0 : Number(argv.ssl_port),
        cert: argv.cert,
        key: argv.key,
        out: argv.out || path.join(os.tmpdir(), 'spikeB', 'captures'),
        client: argv.client || 'awscatalog',
        arn: argv.arn || capture.DEFAULT_ARN,
        access_key: argv.access_key || capture.DEFAULT_ACCESS_KEY,
        secret_key: argv.secret_key || capture.DEFAULT_SECRET_KEY,
        warehouse_base: strip_trailing_slash(argv.warehouse_base || 's3://mytables--table-s3-nb'),
        trailing_slash: argv.trailing_slash === undefined ? 'on' : String(argv.trailing_slash),
        // Story 16 rests on the claim that AWS's catalog library deletes a table whose first
        // commit failed, using the version token. Rejecting that commit is how the spike sees it.
        fail_first_commit: Boolean(argv.fail_first_commit),
        quiet: argv.quiet === undefined ? true : Boolean(argv.quiet),
    };
    if (!['on', 'off'].includes(config.trailing_slash)) {
        throw new Error(`--trailing_slash must be on or off, got ${config.trailing_slash}`);
    }
    fs.mkdirSync(config.out, { recursive: true });
    config.journal = path.join(config.out, 'journal.jsonl');
    config.state = { namespaces: new Map(), tables: new Map() };
    config.respond = respond;

    console.log('S3 Tables stub server');
    console.log('  client         :', config.client);
    console.log('  table bucket   :', config.arn);
    console.log('  warehouse base :', config.warehouse_base);
    console.log('  trailing slash :', config.trailing_slash);
    console.log('  captures       :', config.out);
    console.log('  journal        :', config.journal);

    if (config.port) capture.start_server(http.createServer(), config, config.port, 'http');
    if (config.ssl_port) {
        const opts = { cert: fs.readFileSync(config.cert), key: fs.readFileSync(config.key) };
        capture.start_server(https.createServer(opts), config, config.ssl_port, 'https');
    }
}

function print_help() {
    console.log(`
Usage: node ${path.relative('.', __filename)} [options]

Options:
    --help                   Show this help
    --port <n>               HTTP port (default 8080, 0 to disable)
    --ssl_port <n>           HTTPS port (default disabled); needs --cert and --key
    --cert <file>            TLS certificate
    --key <file>             TLS private key
    --out <dir>              Where to write .sreq captures and the journal
    --client <name>          Label for the captured files, e.g. awscatalog, awscli
    --arn <arn>              Table bucket ARN the stub pretends to serve
    --access_key <ak>        Expected access key
    --secret_key <sk>        Its secret, used to recompute signatures
    --warehouse_base <url>   Backing-bucket URL table locations are assigned under
    --trailing_slash on|off  Whether the assigned warehouseLocation ends in '/'
    --fail_first_commit      Reject a table's first UpdateTableMetadataLocation with 400,
                             to observe what the client does with a half-created table
    --quiet false            Print every candidate signature rule, not just the verdict

State lives in memory only: restarting the stub forgets every namespace and table, which
is what makes one scenario per run reproducible.
`);
}

function strip_trailing_slash(s) {
    return s.replace(/\/+$/, '');
}

let token_seq = 0;

/**
 * Version tokens are opaque to the client, so the stub issues an obviously fake one.
 * A random hex string would read as a credential to secret scanners, and these requests
 * are committed verbatim as signature fixtures - the bodies cannot be edited afterwards
 * without invalidating the signature the fixture exists to verify.
 */
function new_token() {
    token_seq += 1;
    return `EXAMPLEversionToken${token_seq}`;
}

function journal(config, entry) {
    fs.appendFileSync(config.journal, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
}

/**
 * The path arrives percent-encoded, one segment per `{...}` in the S3 Tables request URI.
 * `{tableBucketARN}` is not a greedy parameter, so the slash inside an ARN is `%2F` and a
 * plain split is correct. Decoding is per segment and never on the whole path.
 */
function split_path(raw_path) {
    return raw_path.split('/').filter(Boolean).map(seg => {
        try {
            return decodeURIComponent(seg);
        } catch (err) {
            return seg;
        }
    });
}

function respond(req, res, config, body) {
    const q_index = req.url.indexOf('?');
    const raw_path = q_index < 0 ? req.url : req.url.slice(0, q_index);
    const query = new URLSearchParams(q_index < 0 ? '' : req.url.slice(q_index + 1));
    const seg = split_path(raw_path);
    const json = body && body.length ? safe_json(body) : {};

    // Both return true, which is how a handler tells the router it answered.
    const reply = (code, obj) => {
        res.writeHead(code, {
            'Content-Type': 'application/json',
            'x-amzn-RequestId': crypto.randomUUID(),
        });
        res.end(JSON.stringify(obj));
        console.log(`  answer     : ${code} ${JSON.stringify(obj).slice(0, 300)}`);
        return true;
    };
    // rest-json errors: the AWS SDKs match the modeled exception on x-amzn-errortype first
    // and fall back to __type in the body, so send both.
    const fail = (code, type, message) => {
        res.writeHead(code, {
            'Content-Type': 'application/json',
            'x-amzn-errortype': type,
            'x-amzn-RequestId': crypto.randomUUID(),
        });
        res.end(JSON.stringify({ __type: type, message }));
        console.log(`  answer     : ${code} ${type} - ${message}`);
        return true;
    };

    try {
        return route(req, seg, query, json, config, reply, fail);
    } catch (err) {
        console.error('STUB ERROR', err.stack);
        return fail(500, 'InternalServerException', err.message);
    }
}

function safe_json(body) {
    try {
        return JSON.parse(body.toString('utf8'));
    } catch (err) {
        return { __unparsed: body.toString('utf8') };
    }
}

/** One handler per resource in the S3 Tables request-URI table, keyed on its first segment. */
const RESOURCES = {
    namespaces: route_namespaces,
    tables: route_tables,
    'get-table': route_get_table,
    buckets: route_buckets,
};

function route(req, seg, query, json, config, reply, fail) {
    const handler = RESOURCES[seg[0]];
    const answered = handler && handler(req, seg, query, json, config, reply, fail);
    if (answered) return answered;
    return fail(501, 'NotImplementedException', `${req.method} /${seg.join('/')}: ${NOT_IMPLEMENTED}`);
}

// ---- /namespaces/{tableBucketARN}[/{namespace}] ----
function route_namespaces(req, seg, query, json, config, reply, fail) {
    const { state } = config;
    const method = req.method;
    const bucket_arn = seg[1];
    if (bucket_arn === undefined) return fail(400, 'BadRequestException', 'missing tableBucketARN');
    const ns_name = seg[2];

    if (method === 'PUT' && ns_name === undefined) {
        // CreateNamespace. The modeled member is a list; AWS supports exactly one level.
        const name = Array.isArray(json.namespace) ? json.namespace[0] : json.namespace;
        if (!name) return fail(400, 'BadRequestException', 'missing namespace');
        if (state.namespaces.has(name)) return fail(409, 'ConflictException', `namespace ${name} exists`);
        state.namespaces.set(name, { created_at: new Date().toISOString() });
        journal(config, { op: 'CreateNamespace', bucket_arn, namespace: name });
        return reply(200, { tableBucketARN: bucket_arn, namespace: [name] });
    }
    if (method === 'GET' && ns_name === undefined) {
        return reply(200, {
            namespaces: [...state.namespaces.entries()].map(([name, ns]) => ({
                namespace: [name],
                createdAt: ns.created_at,
                createdBy: '000000000000',
                ownerAccountId: '000000000000',
            })),
        });
    }
    if (method === 'GET') {
        const ns = state.namespaces.get(ns_name);
        if (!ns) return fail(404, 'NotFoundException', `namespace ${ns_name} not found`);
        return reply(200, {
            namespace: [ns_name],
            createdAt: ns.created_at,
            createdBy: '000000000000',
            ownerAccountId: '000000000000',
        });
    }
    if (method === 'DELETE') {
        if (!state.namespaces.has(ns_name)) return fail(404, 'NotFoundException', `namespace ${ns_name} not found`);
        const children = [...state.tables.values()].filter(t => t.namespace === ns_name);
        if (children.length) return fail(409, 'ConflictException', `namespace ${ns_name} is not empty`);
        state.namespaces.delete(ns_name);
        journal(config, { op: 'DeleteNamespace', namespace: ns_name });
        return reply(200, {});
    }
    return undefined;
}

// ---- /tables/{tableBucketARN}/{namespace}[/{name}[/metadata-location|/rename]] ----
function route_tables(req, seg, query, json, config, reply, fail) {
    const { state } = config;
    const method = req.method;
    const bucket_arn = seg[1];
    if (bucket_arn === undefined) return fail(400, 'BadRequestException', 'missing tableBucketARN');
    const ns_name = seg[2];
    const table_name = seg[3];
    const sub = seg[4];

    if (method === 'PUT' && table_name === undefined) {
        // CreateTable. Without `metadata` the table is uninitialized: it has a version
        // token and an assigned warehouse location, and no metadata location at all.
        const name = json.name;
        if (!name) return fail(400, 'BadRequestException', 'missing name');
        if (!state.namespaces.has(ns_name)) return fail(404, 'NotFoundException', `namespace ${ns_name} not found`);
        if (state.tables.has(`${ns_name}/${name}`)) return fail(409, 'ConflictException', `table ${name} exists`);
        const table = {
            id: crypto.randomUUID(),
            namespace: ns_name,
            name,
            version_token: new_token(),
            metadata_location: null,
            created_at: new Date().toISOString(),
        };
        table.warehouse_location = assigned_location(config, table.id);
        state.tables.set(`${ns_name}/${name}`, table);
        journal(config, {
            op: 'CreateTable',
            namespace: ns_name,
            name,
            has_metadata: Boolean(json.metadata),
            request_metadata: json.metadata,
            assigned_warehouse_location: table.warehouse_location,
            version_token: table.version_token,
        });
        return reply(200, { tableARN: table_arn(config, table), versionToken: table.version_token });
    }
    if (method === 'GET' && table_name === undefined) {
        const tables = [...state.tables.values()].filter(t => t.namespace === ns_name);
        return reply(200, {
            tables: tables.map(t => ({
                namespace: [t.namespace],
                name: t.name,
                type: 'customer',
                tableARN: table_arn(config, t),
                createdAt: t.created_at,
                modifiedAt: t.created_at,
            })),
        });
    }

    const table = state.tables.get(`${ns_name}/${table_name}`);
    if (!table) return fail(404, 'NotFoundException', `table ${table_name} not found`);
    return route_one_table({ method, sub, query, json, config, table, reply, fail });
}

/** The operations addressed at one existing table. */
function route_one_table({ method, sub, query, json, config, table, reply, fail }) {
    const { state } = config;
    const where = { namespace: table.namespace, name: table.name };

    if (sub === 'metadata-location' && method === 'GET') {
        const out = { versionToken: table.version_token, warehouseLocation: table.warehouse_location };
        if (table.metadata_location) out.metadataLocation = table.metadata_location;
        journal(config, { op: 'GetTableMetadataLocation', ...where, response: out });
        return reply(200, out);
    }
    if (sub === 'metadata-location' && method === 'PUT') {
        const { versionToken, metadataLocation } = json;
        journal(config, {
            op: 'UpdateTableMetadataLocation',
            ...where,
            sent_metadata_location: metadataLocation,
            sent_version_token: versionToken,
            current_version_token: table.version_token,
            current_metadata_location: table.metadata_location,
            assigned_warehouse_location: table.warehouse_location,
        });
        if (config.fail_first_commit && !table.metadata_location) {
            return fail(400, 'BadRequestException', 'spike stub: first commit rejected on purpose');
        }
        if (versionToken !== table.version_token) {
            return fail(409, 'ConflictException',
                `version token mismatch: have ${table.version_token}, got ${versionToken}`);
        }
        if (!metadataLocation) return fail(400, 'BadRequestException', 'missing metadataLocation');
        table.metadata_location = metadataLocation;
        table.version_token = new_token();
        return reply(200, {
            name: table.name,
            tableARN: table_arn(config, table),
            namespace: [table.namespace],
            versionToken: table.version_token,
            metadataLocation: table.metadata_location,
        });
    }
    if (sub === 'rename' && method === 'PUT') {
        if (json.versionToken && json.versionToken !== table.version_token) {
            return fail(409, 'ConflictException', 'version token mismatch');
        }
        const new_ns = json.newNamespaceName || table.namespace;
        const new_name = json.newName || table.name;
        state.tables.delete(`${table.namespace}/${table.name}`);
        table.namespace = new_ns;
        table.name = new_name;
        table.version_token = new_token();
        state.tables.set(`${new_ns}/${new_name}`, table);
        journal(config, { op: 'RenameTable', ...where, to_namespace: new_ns, to_name: new_name });
        return reply(200, {});
    }
    if (sub === undefined && method === 'DELETE') {
        const sent = query.get('versionToken');
        journal(config, {
            op: 'DeleteTable', ...where, sent_version_token: sent, current_version_token: table.version_token,
        });
        if (sent && sent !== table.version_token) {
            return fail(409, 'ConflictException', 'version token mismatch');
        }
        state.tables.delete(`${table.namespace}/${table.name}`);
        return reply(200, {});
    }
    if (sub === 'encryption' && method === 'GET') {
        return reply(200, { encryptionConfiguration: { sseAlgorithm: 'AES256' } });
    }
    return undefined;
}

// ---- /get-table?tableBucketARN=&namespace=&name= ----
function route_get_table(req, seg, query, json, config, reply, fail) {
    if (req.method !== 'GET') return undefined;
    const table = config.state.tables.get(`${query.get('namespace')}/${query.get('name')}`);
    if (!table) return fail(404, 'NotFoundException', `table ${query.get('name')} not found`);
    const out = {
        name: table.name,
        type: 'customer',
        tableARN: table_arn(config, table),
        namespace: [table.namespace],
        versionToken: table.version_token,
        warehouseLocation: table.warehouse_location,
        createdAt: table.created_at,
        createdBy: '000000000000',
        modifiedAt: table.created_at,
        modifiedBy: '000000000000',
        ownerAccountId: '000000000000',
        format: 'ICEBERG',
    };
    if (table.metadata_location) out.metadataLocation = table.metadata_location;
    return reply(200, out);
}

// ---- /buckets[/{tableBucketARN}] ----
function route_buckets(req, seg, query, json, config, reply, fail) {
    if (req.method !== 'GET') return undefined;
    const summary = arn => ({
        arn,
        name: String(arn).split('/').pop(),
        ownerAccountId: '000000000000',
        createdAt: new Date().toISOString(),
    });
    if (seg.length === 1) return reply(200, { tableBuckets: [summary(config.arn)] });
    return reply(200, summary(seg[1]));
}

/**
 * The location the server assigns a table, per design section 3.3:
 * `s3://<backing-bucket>/<table-id>`, with the trailing slash under test.
 */
function assigned_location(config, table_id) {
    const base = `${config.warehouse_base}/${table_id}`;
    return config.trailing_slash === 'on' ? base + '/' : base;
}

function table_arn(config, table) {
    return `${config.arn}/table/${table.id}`;
}

exports.respond = respond;
exports.assigned_location = assigned_location;

if (require.main === module) main();
