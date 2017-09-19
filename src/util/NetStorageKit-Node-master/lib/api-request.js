'use strict'
const Auth = require('./api-auth')
const Parser = require('./api-request-parser')
const path = require('path')
const http = require('http')
const https = require('https')
const fs = require('fs')

class Requestor {
  constructor(requestorOptions) {
    this.requestorOptions = requestorOptions
    if (!this.requestorOptions instanceof Object) {
      throw new TypeError('[Requestor Error] options should be an object')
    } else if (!(this.requestorOptions.hostname && this.requestorOptions.keyName && this.requestorOptions.key && this.requestorOptions.ssl != undefined)) {
      throw new Error('[Requestor Error] options object should contain key, keyName, hostname, and ssl attributes')
    }

    this.auth = new Auth({ key: this.requestorOptions.key, keyName: this.requestorOptions.keyName })
    this.parser = new Parser()
  }

  makeRequest(requestArgs, callback) {

    const acs_action = `version=1&action=${requestArgs.action}`
    const netstoragePath = this.validatePath(requestArgs.path)
    const authData = this.auth.auth(netstoragePath, acs_action)

    var options = {
      method: requestArgs.method,
      host: this.requestorOptions.hostname,
      path: netstoragePath,
      headers: {
        'X-Akamai-ACS-Action': acs_action,
        'X-Akamai-ACS-Auth-Data': authData.acs_auth_data,
        'X-Akamai-ACS-Auth-Sign': authData.acs_auth_sign,
        'Accept-Encoding': 'identity',
        'User-Agent': 'NetStorageKit-Node'
      }
    }

    var request = (this.requestorOptions.ssl ? https:http).request(options, (res) => {
      var rawData = ''
      res.setEncoding('binary')
      res
      .on('data', (data) => {
        rawData += data
      })
      .on('end', () => {
        if (requestArgs.action == 'download') {
          var local_destination = requestArgs.destination
          if (requestArgs.path.endsWith('/')) {
            callback(new Error('[Netstorage Error] Nestorage Path should be a file, not directory'), null, null)
            return
          } else if (local_destination == '') {
            local_destination = path.basename(requestArgs.path)
          } else {
            try {
              if (fs.statSync(local_destination).isDirectory()) {
                local_destination = path.join(local_destination, path.basename(requestArgs.path))
              }
            } catch (e) {}
          }
          try {
            fs.writeFileSync(local_destination, rawData, 'binary')
          } catch (e) {
            callback(e)
            return
          }
          callback(null, res, {message: 'Download Done.'})
        } else {
          this.parser.parse(rawData, (err, json) => {
            if (requestArgs.action == 'upload' && !rawData && res.statusCode == 200 ) {
              // For Object Store upload response: {}
              callback(null, res, {message: 'Request Processed.'})
            } else {
              callback(null, res, json)
            }
          })
        }
      })
    })

    request
    .on('error', (err) => {
      callback(err, null, null)
    })

    if (requestArgs.action == 'upload') {
      try {
        request.write(fs.readFileSync(requestArgs.source))
      } catch (err) {
        callback(err, null, null)
      }
    }

    request.end()
  }

  validatePath(path) {
    this.path = path
    if (!this.path.startsWith('/')) {
      return escape(`/${this.path}`)
    }
    return escape(this.path)
  }
}

module.exports = Requestor
