/* Copyright (C) 2016 NooBaa */

import { deepFreeze, unique, groupBy, flatMap, makeArray } from 'utils/core-utils';
import { stringifyAmount } from 'utils/string-utils';

const resiliencyTypeToBlockTypes = deepFreeze({
    REPLICATION: [
        'REPLICA'
    ],
    ERASURE_CODING: [
        'DATA',
        'PARITY'
    ]
});

export function getObjectId(bucket, key, versionId, uploadId) {
    return uploadId ?
        `${bucket}:${key}:${versionId}:${uploadId}` :
        `${bucket}:${key}:${versionId}`;
}

export function splitObjectId(objId) {
    const [bucket, key, version, uploadId ] = objId.split(':');
    return { bucket, key, version, uploadId };
}

export function summerizePartDistribution(bucket, part) {
    const { resiliency, placement } = bucket;

    const mirrorSets = flatMap(
        placement.tiers,
        tier => tier.mirrorSets
    );

    const blocksByGorupId = groupBy(
        part.blocks,
        block => _getBlockGroupID(
            block,
            mirrorSets.map(mirrorSet => mirrorSet.name),
            resiliency.kind
        ),
    );

    const groups = mirrorSets
        .map((mirrorSet, index) => {
            const type = 'MIRROR_SET';
            const { name, resources } = mirrorSet;
            const realBlocks = blocksByGorupId[name] || [];
            const storagePolicy = _findStoragePolicy(resources, resiliency, realBlocks);
            const blocks = _fillInMissingBlocks(realBlocks, storagePolicy);
            return { type, index, storagePolicy, resources, blocks };
        });

    const removedBlocks = blocksByGorupId['REMOVED'];
    if (removedBlocks) {
        const blocks = removedBlocks
            .map(block => {
                if (block.mode !== 'HEALTHY') {
                    return block;
                }

                return {
                    ...block,
                    mode: 'WIPING'
                };
            });

        groups.push({
            type: 'TO_BE_REMOVED',
            index: groups.length,
            storagePolicy: _countBlocksByType(removedBlocks),
            blocks: blocks,
            resources: []
        });
    }

    return groups;
}

export function formatBlockDistribution(counters, seperator = ' | ') {
    const {
        replicas = 0,
        dataFrags = 0,
        parityFrags = 0,
        toBeRemoved = 0
    } = counters;

    const parts = [];
    if (replicas > 0) {
        parts.push(stringifyAmount('Replica', replicas));
    }

    if (dataFrags > 0) {
        parts.push(stringifyAmount('Data Fragment', dataFrags));
    }

    if (parityFrags > 0) {
        parts.push(stringifyAmount('Parity Fragment', parityFrags));
    }

    if (toBeRemoved > 0) {
        parts.push(`To Be Removed: ${stringifyAmount('block', toBeRemoved)}`);
    }

    return parts.join(seperator);
}

function _getStorageType(resources, blocks) {
    const types = unique(resources.map(res => res.type));
    if (types.length === 1) return types[0];

    const [candidate] = blocks;
    if (candidate) return candidate.storage.kind;

    return 'HOSTS';
}

function _mockBlock(kind, seq) {
    const mode = 'MOCKED';
    return { kind, seq, mode };
}

function _findStoragePolicy(resources, resiliency, blocks) {
    const storageType = _getStorageType(resources, blocks);
    if (resiliency.kind === 'REPLICATION') {
        if (storageType === 'HOSTS') {
            return {
                replicas: resiliency.replicas,
                dataFrags: 0,
                parityFrags: 0
            };

        } else {
            return {
                replicas: 1,
                dataFrags: 0,
                parityFrags: 0
            };
        }
    } else {
        return {
            replicas: 0,
            dataFrags: resiliency.dataFrags,
            parityFrags: resiliency.parityFrags
        };
    }
}

function _fillInFragBlocks(blocks, target, fragType) {
    const bySeq = groupBy(blocks, block => block.seq);
    const lengths = Object.values(bySeq).map(group => group.length);

    // We need to ensure that we show at least 1 copy for each block.
    const copyCount = Math.max(1, ...lengths);

    return flatMap(
        makeArray(target, i => bySeq[i] || []),
        (copies, i) => makeArray(
            copyCount,
            j => copies[j] || _mockBlock(fragType, i)
        )
    );
}

function _fillInMissingBlocks(blocks, storagePolicy) {
    const { replicas, dataFrags, parityFrags } = storagePolicy;

    let {
        REPLICA: replicaBlocks = [],
        DATA: dataBlocks = [],
        PARITY: parityBlocks = []
    } = groupBy(blocks, block => block.kind);

    if (replicas > 0) {
        replicaBlocks = new Array(Math.max(replicas, replicaBlocks.length))
            .fill(true)
            .map((_, i) =>
                replicaBlocks[i] ||
                _mockBlock('REPLICA')
            );
    }

    if (dataFrags > 0) {
        dataBlocks = _fillInFragBlocks(dataBlocks, dataFrags, 'DATA');
    }

    if (parityFrags > 0) {
        parityBlocks = _fillInFragBlocks(parityBlocks, parityFrags, 'PARITY');
    }

    return [
        ...replicaBlocks,
        ...dataBlocks,
        ...parityBlocks
    ];
}

function _getBlockGroupID(block, placementMirroSets, resiliencyType) {
    const allowedBlockType = resiliencyTypeToBlockTypes[resiliencyType];
    return true &&
        // Block does not match a mirror set in the bucket.
        (!block.mirrorSet && 'REMOVED') ||

        // Block was not rebuild after resilency change
        (!allowedBlockType.includes(block.kind) && 'REMOVED') ||

        // Here to help find bug if block to mirror set mappings.
        (!placementMirroSets.includes(block.mirrorSet) && 'REMOVED') ||

        // Block group id is the mirror set id.
        block.mirrorSet;
}

function _countBlocksByType(blocks) {
    return blocks.reduce(
        (counters, block) => {
            if (block.kind === 'REPLICA') ++counters.replicas;
            else if (block.kind === 'DATA') ++counters.replicas;
            else if (block.kind === 'PARITY') ++counters.replicas;
            return counters;
        },
        {
            replicas: 0,
            dataFrags:  0,
            parityFrags: 0
        }
    );
}

export function formatVersionId(versionId) {
    return versionId === 'null' ? 'Null' : versionId;
}
