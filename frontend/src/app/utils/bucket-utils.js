import { deepFreeze } from 'utils/core-utils';

const gatewayBucketToStateIcon = deepFreeze({
    OPTIMAL: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Healthy',
    }
});

export function getGatewayBucketStateIcon(bucket) {
    const { mode } = bucket;
    return gatewayBucketToStateIcon[mode];
}
