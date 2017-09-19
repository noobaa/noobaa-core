'use strict'
const xml2js = require('xml2js')
const _ = require('lodash')

class Parser {
  constructor() {
    this.parser = new xml2js.Parser()
  }

  parse(xmlPayload, callback) {
    this.xmlPayload = xmlPayload
    this.parser.parseString(this.xmlPayload, (err, results) => {
      if (err) {
        return callback(null, { message: this.xmlPayload.trim() })
      }

      const parsedResults = _.mergeWith({}, results, function(a, b) {
        var obj = {}
        Object.keys(b).forEach(function(key) {
          if (key === '$') {
            obj.attribs = b[key]
          } else if (_.isArray(b[key])) {
            obj[key] = _.map(b[key], '$')
          }
        })
        return obj
      })
      return callback(null, parsedResults)
    })
  }

}

module.exports = Parser
