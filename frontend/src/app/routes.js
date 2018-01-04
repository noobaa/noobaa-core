/* Copyright (C) 2016 NooBaa */

const root = '/fe';

export const asset              = `${root}/assets/:asset`;
export const system             = `${root}/systems/:system`;
export const buckets            = `${root}/systems/:system/buckets/:tab?`;
export const bucket             = `${root}/systems/:system/buckets/data-buckets/:bucket/:tab?/:section?`;
export const namespaceBucket    = `${root}/systems/:system/buckets/namespace-buckets/:bucket/:tab?`;
export const object             = `${root}/systems/:system/buckets/:bucket/objects/:object/:tab?`;
export const resources          = `${root}/systems/:system/resources/:tab?`;
export const pool               = `${root}/systems/:system/resources/pools/:pool/:tab?`;
export const host               = `${root}/systems/:system/resources/pools/:pool/nodes/:host/:tab?`;
export const management         = `${root}/systems/:system/management/:tab?/:section?`;
export const accounts           = `${root}/systems/:system/accounts`;
export const account            = `${root}/systems/:system/accounts/:account/:tab?`;
export const cluster            = `${root}/systems/:system/cluster/:tab?`;
export const server             = `${root}/systems/:system/cluster/servers/:server/:tab?`;
export const funcs              = `${root}/systems/:system/functions`;
export const func               = `${root}/systems/:system/functions/:func/:tab?`;
