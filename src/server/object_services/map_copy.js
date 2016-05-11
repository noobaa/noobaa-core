'use strict';

const _ = require('lodash');

const P = require('../../util/promise');
const md_store = require('./md_store');
// const dbg = require('../../util/debug_module')(__filename);

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
                return md_store.ObjectPart.collection.find({
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
                    return md_store.ObjectPart.collection.insertMany(new_parts);
                }
            });
    }


}

exports.MapCopy = MapCopy;
