// Original author: Astin Choi <achoi@akamai.com>

// Copyright 2016 Akamai Technologies http://developer.akamai.com.

// Licensed under the Apache License, Version 2.0 (the "License")
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at

//     http://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict'
const expect = require('chai').expect
const fs = require('fs')
const Netstorage = require('../lib/netstorage')

var config = {}
if (process.env.TEST_MODE === 'TRAVIS') {
  config = { hostname: process.env.NS_HOST, 
    keyName: process.env.NS_KEYNAME, 
    key: process.env.NS_KEY, 
    cpCode: process.env.NS_CPCODE , 
    ssl: false }
} else {
  config = JSON.parse(fs.readFileSync(__dirname + '/api-config.json'))
}

var ns = new Netstorage(config)
var temp_ns_dir = `/${config.cpCode}/nst_${Date.now()}`
var temp_file = `nst_${Date.now()}.txt`
var temp_ns_file = `${temp_ns_dir}/${temp_file}`
const mtime_now = Math.floor(new Date().getTime() / 1000)

describe('### Netstorage test ###', function() {
  this.slow(5000)
  after(function(done) {
    try {
      fs.unlinkSync(`${__dirname}/${temp_file}`)
      fs.unlinkSync(`${__dirname}/../${temp_file}_rename`)
    } catch (err) {
      console.log(err)
    } finally {
      done()
    }

  })

  describe(`ns.dir("/${config.cpCode}", callback);`, function() {
    it('should return 200 OK', function(done) {
      ns.dir(`/${config.cpCode}`, (error, response, body) => {
        expect(response.statusCode).to.equal(200)
        return done()
      })
    })
  })

  describe(`ns.list({ path: "/${config.cpCode}", actions: { "max_entries": 5 } }, callback);`, function() {
    it('should return 200 OK', function(done) {
      ns.list({ path: `/${config.cpCode}`, actions: { max_entries: 5 } }, (error, response, body) => {
        expect(response.statusCode).to.equal(200)
        expect(body.list.file.length).to.equal(5)
        done()
      })
    })
  })

  describe(`ns.mkdir("${temp_ns_dir}", callback);`, function() {
    it('should return 200 OK', function(done) {
      ns.mkdir(temp_ns_dir, (error, response, body) => {
        expect(response.statusCode).to.equal(200)
        done()
      })
    })
  })

  describe(`ns.upload("${__dirname}/${temp_file}", "${temp_ns_file}", callback);`, function() {
    it('should return 200 OK', function(done) {
      fs.writeFileSync(`${__dirname}/${temp_file}`, 'Hello, Netstorage API World!', 'utf8')
      ns.upload(`${__dirname}/${temp_file}`, temp_ns_file, (error, response, body) => {
        if (error) { throw error }
        expect(response.statusCode).to.equal(200)
        done()
      })
    })
  })

  describe(`ns.du("${temp_ns_dir}", callback);`, function() {
    it('should return 200 OK', function(done) {
      ns.du(temp_ns_dir, (error, response, body) => {
        expect(response.statusCode).to.equal(200)
        done()
      })
    })
  })

  describe(`ns.mtime("${temp_ns_file}", ${mtime_now}, callback);`, function() {
    it('should return 200 OK', function(done) {
      ns.mtime(temp_ns_file, mtime_now, (error, response, body) => {
        if (error) {
          throw error
        }
        expect(response.statusCode).to.equal(200)
        done()
      })
    })
  })

  describe(`ns.stat("${temp_ns_file}", callback);`, function() {
    it('should return 200 OK', function(done) {
      ns.stat(temp_ns_file, (error, response, body) => {
        expect(response.statusCode).to.equal(200)
        done()
      })
    })
  })

  describe(`ns.symlink("${temp_ns_file}", "${temp_ns_file}_lnk", callback);`, function() {
    it('should return 200 OK', function(done) {
      ns.symlink(temp_ns_file, `${temp_ns_file}_lnk`, (error, response, body) => {
        expect(response.statusCode).to.equal(200)
        done()
      })
    })
  })

  describe(`ns.rename("${temp_ns_file}", "${temp_ns_file}_rename", callback);`, function() {
    it('should return 200 OK', function(done) {
      ns.rename(temp_ns_file, `${temp_ns_file}_rename`, (error, response, body) => {
        expect(response.statusCode).to.equal(200)
        done()
      })
    })
  })

  describe(`ns.download("${temp_ns_file}_rename", callback);`, function() {
    it('should return 200 OK', function(done) {
      ns.download(`${temp_ns_file}_rename`, (error, response, body) => {
        expect(response.statusCode).to.equal(200)
        done()
      })
    })
  })

  describe(`ns.delete("${temp_ns_file}_rename", callback);`, function() {
    it('should return 200 OK', function(done) {
      ns.delete(`${temp_ns_file}_rename`, (error, response, body) => {
        expect(response.statusCode).to.equal(200)
        done()
      })
    })
  })

  describe(`ns.delete("${temp_ns_file}_lnk", callback);`, function() {
    it('should return 200 OK', function(done) {
      ns.delete(`${temp_ns_file}_lnk`, (error, response, body) => {
        expect(response.statusCode).to.equal(200)
        done()
      })
    })
  })

  describe(`ns.rmdir("${temp_ns_dir}", callback);`, function() {
    it('should return 200 OK', function(done) {
      ns.rmdir(temp_ns_dir, (error, response, body) => {
        expect(response.statusCode).to.equal(200)
        done()
      })
    })
  })
})


describe('### Error test ###', function() {
  this.slow(500)
  describe(`ns.dir('invalid ns path', callback);`, function() {
    it('should get Error object', function(done) {
      ns.dir('Invalid ns path', (error, response, body) => {
        if (error) {
          expect(error).to.be.instanceof(Error)
          expect(error.message).to.equal('[Netstorage Error] Invalid netstorage path')
        }
        done()
      })
    })
  })

  describe('ns.list({ path: "INVALID NS PATH", actions: { max_entries: 5 } }, callback)', function() {
    it('should get Error object', function(done) {
      ns.list({ path: "INVALID NS PATH", actions: { max_entries: 5 } }, (error, response, body) => {
        if (error) {
          expect(error).to.be.instanceof(Error)
          expect(error.message).to.equal('[Netstorage Error] Invalid netstorage path')
        }
        done()
      })
    })
  })

  describe(`ns.list({ path: "/${config.cpCode}" }, callback);`, function() {
    it('should get Error object', function(done) {
      ns.list({ path: `/${config.cpCode}` }, (error, response, body) => {
        if (error) {
          expect(error).to.be.instanceof(Error)
          expect(error.message).to.equal('[Netstorage Error] If an options object is passed, it must contain an "actions" object with key/value pairs for each action option')
        }
        done()
      })
    })
  })

  describe(`ns.upload("invalid local path", "${temp_ns_file}" callback);`, function() {
    it('should get Error object', function(done) {
      ns.upload('Invalid local path', temp_ns_file, (error, response, body) => {
        if (error) {
          expect(error).to.be.instanceof(Error)
        }
        done()
      })
    })
  })

  describe(`ns.download("/123456/directory/", "${__dirname}/${temp_file}" callback);`, function() {
    it('should get Error object', function(done) {
      ns.download('/123456/directory/', `${__dirname}/${temp_file}`, (error, response, body) => {
        if (error) {
          expect(error).to.be.instanceof(Error)
        }
        done()
      })
    })
  })

})
