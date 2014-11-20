// this single module makes it more convinient to get to all the models
module.exports = {
    System: require('./system'),
    Account: require('./account'),
    Tier: require('./tier'),
    Node: require('./node'),
    NodeVendor: require('./node_vendor'),
    StorageVendor: require('./storage_vendor'),
    Bucket: require('./bucket'),
    ObjectMD: require('./object_md'),
    ObjectPart: require('./object_part'),
    DataChunk: require('./data_chunk'),
    DataBlock: require('./data_block'),
};
