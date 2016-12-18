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
export const account        = `${root}/systems/:system/management/accounts/:account/:tab?`;
export const management     = `${root}/systems/:system/management/:tab?/:section?`;
export const cluster        = `${root}/systems/:system/cluster/:tab?`;
export const server         = `${root}/systems/:system/cluster/servers/:server/:tab?`;
export const funcs          = `${root}/systems/:system/functions`;
export const func           = `${root}/systems/:system/functions/:func/:tab?`;
