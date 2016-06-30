const root = '/fe';

export const asset          = `${root}/assets/:asset`;
export const unauthorized   = `${root}/unauthorized`;
export const login          = `${root}/login`;
export const system         = `${root}/systems/:system`;
export const buckets        = `${root}/systems/:system/buckets`;
export const bucket         = `${root}/systems/:system/buckets/:bucket/:tab?`;
export const object         = `${root}/systems/:system/buckets/:bucket/objects/:object/:tab?`;
export const pools          = `${root}/systems/:system/resources/:tab?`;
export const pool           = `${root}/systems/:system/resources/pools/:pool/:tab?`;
export const node           = `${root}/systems/:system/resources/pools/:pool/nodes/:node/:tab?`;
export const management     = `${root}/systems/:system/management/:tab?`;
export const cluster        = `${root}/systems/:system/cluster`;

