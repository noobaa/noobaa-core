'use strict';

var _ = require('lodash');
var P = require('../../util/promise');
var md_store = require('../stores/md_store');
// var map_utils = require('./map_utils');
// var dbg = require('../../util/debug_module')(__filename);
var db = require('../db');

// dbg.set_level(5);


/**
 *
 * The mapping allocation flow
 *
 */
class MapCopy {

    constructor(source_obj, target_obj) {
        this.source_obj = source_obj;
        this.target_obj = target_obj;
    }

    run() {
        return P.fcall(() => {
                return db.ObjectPart.collection.find({
                    system: this.source_obj.system,
                    obj: this.source_obj._id,
                    deleted: null
                }).toArray();
            })
            .then(parts => {
                let new_parts = _.map(parts, part => {
                    return _.defaults({
                        _id: md_store.make_md_id(),
                        system: this.target_obj.system,
                        obj: this.target_obj._id,
                    }, part);
                });
                if (new_parts.length) {
                    return db.ObjectPart.collection.insertMany(new_parts);
                }
            });
    }


}

exports.MapCopy = MapCopy;
