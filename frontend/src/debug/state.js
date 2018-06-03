/* Copyright (C) 2016 NooBaa */

import { Subject } from 'rxjs';
import { startWith, scan, shareReplay } from 'rxjs/operators';

const maxLogSize = 200;

const intialState = {
    targetId: '',
    filter: '',
    messages: [],
    selectedMessage: 0,
    stateView: 'diff'
};

const reducers = Object.freeze({
    INITIALIZE: onInitialize,
    ACCEPT_MESSAGE: onAcceptMessage,
    DROP_MESSAGES: onDropMessages,
    SET_MESSAGE_FILTER: onSetMessageFilter,
    SELECT_MESSAGE: onSelectMessage,
    SELECTE_STATE_VIEW: onSelectStateView,
    REPLACE_MESSAGES: onReplaceMessages
});

function reduceState(prev, action) {
    const reducer = reducers[action.type];
    return reducer ? reducer(prev, action) : prev;
}

function onInitialize(prev, action) {
    const { targetId } = action.payload;
    return { ...prev, targetId };
}

function onAcceptMessage(prev, action) {
    const lastMessage = prev.messages[prev.messages.length - 1];
    const id = lastMessage ? lastMessage.id + 1 : 1;
    const messages = prev.messages
        .concat({ id, ...action.payload })
        .slice(-maxLogSize);

    const selected = messages.find(message => message.id === prev.selectedMessage);
    const selectedMessage = selected && selected.id;

    return {
        ...prev,
        messages,
        selectedMessage
    };
}

function onDropMessages(prev) {
    return {
        ...prev,
        messages: [],
        selectedMessage: 0
    };
}

function onSetMessageFilter(prev, action) {
    return {
        ...prev,
        filter: action.payload.filter
    };
}

function onSelectMessage(prev, action) {
    const { id: selectedMessage } = action.payload;
    return { ...prev, selectedMessage };
}

function onSelectStateView(prev, action) {
    const { view: stateView } = action.payload;
    return {  ...prev, stateView };
}

function onReplaceMessages(prev, action) {
    let seq = 0;
    const messages = action.payload
        .slice(-maxLogSize)
        .map(message => ({ id: ++seq, ...message }));

    return {
        ...prev,
        messages: messages,
        filter: '',
        selectedMessage: 0
    };
}

export const action$ = new Subject();

export const state$ = action$.pipe(
    startWith(intialState),
    scan(reduceState),
    shareReplay(1)
);

// Subscribe to the stream to ensure availability of last state
// even before real subscriptions.
state$.subscribe(() => {});

