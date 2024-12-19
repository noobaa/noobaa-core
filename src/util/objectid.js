'use strict';

const { hostname } = require('os');
const { fnv1a24 } = require('./fnv1a');
const { Buffer } = require('buffer');

const MACHINE_ID = fnv1a24(hostname());
const HEX_REGEX = /^[0-9a-fA-F]{24}$/;
const HAS_BUFFER_SUPPORT = typeof Buffer !== 'undefined' && typeof Buffer.from === 'function';

/**
 * ObjectID class to create and handle ObjectId instances.
 */
class ObjectID {
  static cacheHexString = false;
  static index = Math.floor(Math.random() * 0xffffff);

  constructor(id) {
    if (id instanceof ObjectID) return id;
    if (!(this instanceof ObjectID)) return new ObjectID(id);

    this._bsontype = 'ObjectID';

    if (id == null || typeof id === 'number') {
      this.id = this.generate(id);
      if (ObjectID.cacheHexString) this.__id = this.toHexString();
      return;
    }

    if (!ObjectID.isValid(id)) {
      throw new TypeError(
        'Argument passed in must be a 12-byte string, a 24-byte hex string, or a valid ObjectID instance'
      );
    }

    if (typeof id === 'string') {
      if (id.length === 24) {
        this.id = Buffer.from(id, 'hex');
      } else if (id.length === 12) {
        this.id = Buffer.from(id, 'utf8');
      }
    } else if (id instanceof Buffer && id.length === 12) {
      this.id = id;
    }

    if (ObjectID.cacheHexString) this.__id = this.toHexString();
  }

  toHexString() {
    if (ObjectID.cacheHexString && this.__id) return this.__id;

    if (!this.id || !(this.id instanceof Buffer)) {
      throw new TypeError(
        `Invalid ObjectId, expected a Buffer but received: ${JSON.stringify(this.id)}`
      );
    }

    const hexString = this.id.toString('hex');
    if (ObjectID.cacheHexString) this.__id = hexString;
    return hexString;
  }

  toString() {
    return this.toHexString();
  }

  toJSON() {
    return this.toHexString();
  }

  equals(otherId) {
    if (otherId instanceof ObjectID) {
      return this.toString() === otherId.toString();
    }

    if (typeof otherId === 'string' && ObjectID.isValid(otherId)) {
      return otherId.length === 24
        ? otherId.toLowerCase() === this.toHexString()
        : otherId === this.id;
    }

    return false;
  }

  getTimestamp() {
    const time =
      (this.id[3] | (this.id[2] << 8) | (this.id[1] << 16) | (this.id[0] << 24)) >>> 0;
    return new Date(time * 1000);
  }

  generate(time) {
    const buffer = Buffer.alloc(12);
    time = typeof time === 'number' ? time : Math.floor(Date.now() / 1000);

    const pid = (process.pid || Math.floor(Math.random() * 0xffff)) & 0xffff;
    const inc = ObjectID.index = (ObjectID.index + 1) % 0xffffff;

    buffer.writeUInt32BE(time, 0);
    buffer.writeUIntBE(MACHINE_ID, 4, 3);
    buffer.writeUInt16BE(pid, 7);
    buffer.writeUIntBE(inc, 9, 3);

    return buffer;
  }

  static createFromHexString(hexString) {
    if (!HEX_REGEX.test(hexString)) {
      throw new TypeError(
        'Argument passed in must be a 24-byte hex string'
      );
    }
    return new ObjectID(Buffer.from(hexString, 'hex'));
  }

  static isValid(id) {
    if (id == null) return false;

    if (typeof id === 'string') {
      return id.length === 12 || (id.length === 24 && HEX_REGEX.test(id));
    }

    if (id instanceof ObjectID || (id instanceof Buffer && id.length === 12)) {
      return true;
    }

    return id?.toHexString && ObjectID.isValid(id.id);
  }
}

module.exports = ObjectID;
