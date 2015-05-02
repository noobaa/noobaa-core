/* global db, printjson */

/**
 *
 * mongodb script to clear the objects and nodes from the db.
 *
 * usage: mongo nbcore clear_db.js
 *
 */

db.datablocks.drop();
db.datachunks.drop();
db.objectparts.drop();
db.objectmds.drop();
db.nodes.drop();

printjson(db.getCollectionNames());
