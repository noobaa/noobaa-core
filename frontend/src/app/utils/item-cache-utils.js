import {
    deepFreeze,
    echo,
    mapValues,
    createCompareFunc,
    hashCode,
    flatMap,
    omitUndefined
} from 'utils/core-utils';

export const initialState = deepFreeze({
    items: {},
    queries: {},
    views: {}
});

export function handleFetch(state, query, view, timestamp, queryLimit, itemLimit) {
    const queryKey = _generateQueryKey(query);
    const queryState = {
        ...(state.queries[queryKey] || {}),
        timestamp: timestamp,
        fetching: true,
        error: false
    };

    const newState = {
        ...state,
        queries: {
            ...state.queries,
            [queryKey]: queryState
        },
        views: {
            ...state.views,
            [view]: queryKey
        }
    };

    return _clearOverallocated(
        newState,
        queryLimit,
        itemLimit
    );
}

export function handleFetchCompleted(state, query, newItems, extras, queryLimit, itemLimit) {
    const queryKey = _generateQueryKey(query);
    let { queries, items } =  state;
    const queryState = queries[queryKey];

    // If the query is still valid we update the
    // query and add the new items (override the current items).
    if (queryState) {
        queries = {
            ...queries,
            [queryKey]: {
                ...queryState,
                fetching: false,
                error: false,
                result: {
                    items: Object.keys(newItems),
                    ...extras
                }
            }
        };

        items = {
            ...state.items,
            ...newItems
        };

    // If the query is not valid we use the new items to
    // update the items that are already in the cache.
    } else {
        items = mapValues(
            items,
            (item, key) => newItems[key] || items[key]
        );
    }

    const newState = {
        ...state,
        queries: queries,
        items: items
    };

    return _clearOverallocated(
        newState,
        queryLimit,
        itemLimit
    );
}

export function handleFetchFailed(state, query) {
    const queryKey = _generateQueryKey(query);
    const queryState = state.queries[queryKey];
    if (!queryState) return state;

    const updatedQueryState = {
        ...queryState,
        fetching: false,
        error: true
    };

    return {
        ...state,
        queries: {
            ...state.queries,
            [queryKey]: updatedQueryState
        }
    };
}

export function handleDropView(state, view) {
    return {
        ...state,
        views: omitUndefined({
            ...state.views,
            [view]: undefined
        })
    };
}

export function handleUpdateItem(state, key, updates) {
    const item = state.items[key];
    if (!item) return state;

    return {
        ...state,
        items: {
            ...state.items,
            [key]: {
                ...item,
                ...updates
            }
        }
    };
}

export function handleRemoveItem(state, itemKey, handleExtras = echo) {
    const item = state.items[itemKey];
    if (!item) return state;

    const items = omitUndefined({
        ...items,
        [itemKey]: undefined
    });

    const queries = mapValues(
        state.queries,
        query => {
            const { items: itemList, ...extras } = query.result;
            const updatedItemList = itemList.filter(item => item !== itemKey);
            if (updatedItemList.length === itemList.length) return query;

            return {
                ...query,
                result: {
                    ...handleExtras(extras, item),
                    items: updatedItemList
                }
            };
        }
    );

    return {
        ...state,
        items,
        queries
    };
}

function _clearOverallocated(state, queryLimit, hostLimit) {
    let overallocatedQueries = Math.max(0, Object.keys(state.queries).length - queryLimit);
    let overallocatedHosts = Math.max(0, Object.keys(state.items).length - hostLimit);

    if (overallocatedQueries > 0 || overallocatedHosts > 0) {
        const lockedQueries = new Set(Object.values(state.views));
        const cadidateQueries =  Object.values(state.queries)
            .filter(query => !lockedQueries.has(query.key) && !query.fetching)
            .sort(createCompareFunc(query => query.timestamp));

        // Remove queries or items
        const queries = { ...state.queries };
        const items = { ...state.items };
        for (const query of cadidateQueries) {
            queries[query.key] = undefined;
            --overallocatedQueries;

            if (query.result) {
                const lockedItems = new Set(flatMap(
                    Object.values(queries),
                    query => query.result ? query.result.items : []
                ));

                for (const itemKey of query.result.items) {
                    if (!lockedItems.has(itemKey)) {
                        items[itemKey] = undefined;
                        --overallocatedHosts;
                    }
                }
            }

            if (overallocatedQueries === 0 && overallocatedHosts <= 0) {
                break;
            }
        }

        return {
            ...state,
            queries: omitUndefined(queries),
            items: omitUndefined(items)
        };

    } else {
        return state;
    }
}

function _generateQueryKey(query) {
    return hashCode(query);
}
