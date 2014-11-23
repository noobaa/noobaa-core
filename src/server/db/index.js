// this single module makes it more convinient to get to all the models
module.exports = {
    System: require('./system'),
    SystemPermission: require('./system_permission'),
    Account: require('./account'),
    Tier: require('./tier'),
    Node: require('./node'),
    Vendor: require('./vendor'),
    Bucket: require('./bucket'),
    ObjectMD: require('./object_md'),
    ObjectPart: require('./object_part'),
    DataChunk: require('./data_chunk'),
    DataBlock: require('./data_block'),
};
