'use strict'
const crypto = require('crypto')

class Auth {
  constructor(opts) {
    this.opts = opts
    if (!this.opts instanceof Object) {
      throw new TypeError('[Auth Error] options should be an object')
    }

    if (!(this.opts.key && this.opts.keyName)) {
      throw new Error('[Auth Error] options object should contain key and keyName attributes')
    }
  }

  auth(netstoragePath, actionHeaders) {
    var acs_auth_data = ''
    var acs_auth_sign = ''

    try {
      acs_auth_data = `5, 0.0.0.0, 0.0.0.0, ${Math.floor(Date.now() / 1000)}, ${Math.floor((Math.random() * 100000))}, ${this.opts.keyName}`
      const sign_string = `${netstoragePath}\nx-akamai-acs-action:${actionHeaders}\n`
      const message = acs_auth_data + sign_string
      acs_auth_sign = crypto.createHmac('sha256', this.opts.key)
        .update(message)
        .digest('base64')
    } catch (err) {
      throw new Error(`[Auth Error] ${err}`)
    }

    return { acs_auth_data: acs_auth_data, acs_auth_sign: acs_auth_sign }
  }
}

module.exports = Auth
