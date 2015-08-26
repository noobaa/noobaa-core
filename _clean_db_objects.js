/* global db, print */

/**
 *
 * mongodb script to clear the objects from the db.
 *
 * usage: mongo nbcore clear_db.js
 *
 */

 print('before DataBlocks', db.datablocks.count());
 print('before DataChunks', db.datachunks.count());
 print('before ObjectParts', db.objectparts.count());
 print('before ObjectMDs', db.objectmds.count());

print('removing DataBlocks ...');
db.datablocks.remove({});
print('removing DataChunks ...');
db.datachunks.remove({});
print('removing ObjectParts ...');
db.objectparts.remove({});
print('removing ObjectMDs ...');
db.objectmds.remove({});

print('after DataBlocks', db.datablocks.count());
print('after DataChunks', db.datachunks.count());
print('after ObjectParts', db.objectparts.count());
print('after ObjectMDs', db.objectmds.count());

print('done.');
