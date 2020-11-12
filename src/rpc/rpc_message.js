/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const buffer_utils = require('../util/buffer_utils');
const schema_utils = require('../util/schema_utils');

const RPC_VERSION_MAGIC = 0xba;
const RPC_VERSION_MAJOR = 0;
const RPC_VERSION_MINOR = 0;
const RPC_VERSION_FLAGS = 0;
const RPC_VERSION_NUMBER = Buffer.from([
    RPC_VERSION_MAGIC,
    RPC_VERSION_MAJOR,
    RPC_VERSION_MINOR,
    RPC_VERSION_FLAGS,
]).readUInt32BE(0);

// Encoding and decoding of rpc messages is a non-symmetric operation
// when using cloning we need to replicate this non symmetry as much as
// possible in order to ensure complaince on both sides of the RPC call.
function clone_customizer(value) {
    // Mongo object ids are always serialized into strings and never deserialized back.
    if (schema_utils.is_object_id_class(value)) {
        return value.toJSON();
    }

    // Explicity returning undefined to empesis the need to return
    // undefined and not the original value.
    return undefined;
}

/**
 * RpcMessage represents a self-contained message that rpc sends/receives over connections.
 * The `body.op` property specifies the type of message but the message encoding is agnostic to it.
 * Known message ops are: `req`, `res`, `ping`, `pong`, `routing_req`, `routing_res`.
 *
 * Buffers can be attached to any message in order to send raw bytes.
 * Note that the message does not preserve the buffers on the receiver side.
 * Multiple buffers might collapse to a single one or vice versa.
 * The only guarantee is that `Buffer.concat(buffers)` will contain the same bytes.
 * So the body itself should provide the information needed to parse the buffers.
 * Refer to how RpcRequest is setting body.buffers to contain the size of every attachment.
 */
class RpcMessage {
    static get RPC_VERSION_NUMBER() {
        return RPC_VERSION_NUMBER;
    }

    /**
     * @param {Object} body is the main payload of the message (json encoded)
     * @param {Buffer[]} [buffers] optional list of buffers to append the body
     */
    constructor(body, buffers) {
        this.body = body;
        this.buffers = buffers || [];
    }

    /**
     * @returns {RpcMessage}
     */
    clone() {
        const { body, buffers } = this;
        return new RpcMessage(
            _.cloneDeepWith(body, clone_customizer),
            buffers.map(Buffer.from)
        );
    }

    /**
     * @returns {Buffer[]}
     */
    encode() {
        const { body, buffers = [] } = this;
        const meta_buffer = Buffer.allocUnsafe(8);
        const body_buffer = Buffer.from(JSON.stringify(body));
        meta_buffer.writeUInt32BE(RPC_VERSION_NUMBER, 0);
        meta_buffer.writeUInt32BE(body_buffer.length, 4);
        const msg_buffers = [
            meta_buffer,
            body_buffer,
            ...buffers
        ];
        return msg_buffers;
    }

    /**
     * @param {Buffer[]} msg_buffers
     * @returns {RpcMessage}
     */
    static decode(msg_buffers) {
        const meta_buffer = buffer_utils.extract_join(msg_buffers, 8);
        const version = meta_buffer.readUInt32BE(0);
        if (version !== RPC_VERSION_NUMBER) {
            const magic = meta_buffer.readUInt8(0);
            const major = meta_buffer.readUInt8(1);
            const minor = meta_buffer.readUInt8(2);
            const flags = meta_buffer.readUInt8(3);
            if (magic !== RPC_VERSION_MAGIC) throw new Error('RPC VERSION MAGIC MISMATCH');
            if (major !== RPC_VERSION_MAJOR) throw new Error('RPC VERSION MAJOR MISMATCH');
            if (minor !== RPC_VERSION_MINOR) throw new Error('RPC VERSION MINOR MISMATCH');
            if (flags !== RPC_VERSION_FLAGS) throw new Error('RPC VERSION FLAGS MISMATCH');
            throw new Error('RPC VERSION MISMATCH');
        }
        const body_length = meta_buffer.readUInt32BE(4);
        const body = JSON.parse(buffer_utils.extract_join(msg_buffers, body_length));

        return new RpcMessage(body, msg_buffers);
    }
}

module.exports = RpcMessage;
