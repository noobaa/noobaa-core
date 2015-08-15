/* global db, print */

/**
 *
 * mongodb script to clear the objects from the db.
 *
 * usage: mongo nbcore clear_db.js
 *
 */

print('removing DataBlocks ...');
db.datablocks.remove();
print('removing DataChunks ...');
db.datachunks.remove();
print('removing ObjectParts ...');
db.objectparts.remove();
print('removing ObjectMDs ...');
db.objectmds.remove();

print('count DataBlocks', db.datablocks.count());
print('count DataChunks', db.datachunks.count());
print('count ObjectParts', db.objectparts.count());
print('count ObjectMDs', db.objectmds.count());
print('done.');
