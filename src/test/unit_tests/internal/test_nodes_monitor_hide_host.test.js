/* Copyright (C) 2026 NooBaa */
'use strict';

process.env.DISABLE_INIT_RANDOM_SEED = 'true';

const system_utils = require('../../../server/utils/system_utils');
const { NodesMonitor } = require('../../../server/node_services/nodes_monitor');

// DFBUGS-11724 - a deleting host must not be hidden before its data was rebuilt elsewhere.
describe('NodesMonitor hiding of deleting hosts', () => {
    const HOST_ID = 'host-1';
    let monitor;

    // a node as read from the store on core startup: marked for deletion, agent not connected yet
    function make_stored_deleting_node(name) {
        return {
            _id: `id-${name}`,
            name,
            peer_id: `peer-${name}`,
            host_id: HOST_ID,
            host_sequence: 1,
            system: 'system-1',
            pool: 'pool-1',
            heartbeat: new Date(),
            deleting: Date.now() - 60000,
            storage: { total: 100, free: 0, used: 100, alloc: 0, limit: 0 },
        };
    }

    function load_host(...names) {
        for (const name of names) monitor._add_existing_node(make_stored_deleting_node(name));
        return monitor._get_nodes_by_host_id(HOST_ID);
    }

    function set_stage(item, stage_name) {
        item.data_activity = { reason: 'DELETING', stage: { name: stage_name, time: { start: Date.now() }, size: {} } };
    }

    beforeEach(() => {
        monitor = new NodesMonitor();
        monitor._clear(); // init the maps, like _load_from_store() does
        jest.spyOn(system_utils, 'system_in_maintenance').mockReturnValue(false);
        jest.spyOn(monitor, '_schedule_rebuild').mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('does not hide a deleting host loaded from store before its data activity is computed', () => {
        const host_nodes = load_host('node-a');
        const [item] = host_nodes;
        expect(item.connection).toBeNull();
        expect(item.data_activity).toBeUndefined();
        expect(monitor._is_host_hideable(host_nodes)).toBe(false);

        // the first _run_node() calls _remove_hideable_nodes() before _update_status()
        const hide_spy = jest.spyOn(monitor, '_hide_host').mockImplementation(() => undefined);
        monitor._remove_hideable_nodes(item);
        expect(hide_spy).not.toHaveBeenCalled();
    });

    it('does not hide a host when only some of its nodes have a data activity', () => {
        const host_nodes = load_host('node-a', 'node-b');
        set_stage(host_nodes[0], 'WIPING');
        expect(monitor._is_host_hideable(host_nodes)).toBe(false);
    });

    it('computes REBUILDING for a loaded deleting node, which is not hideable', () => {
        const host_nodes = load_host('node-a');
        const [item] = host_nodes;
        monitor._update_status(item);
        expect(item.online).toBe(false);
        expect(item.data_activity.reason).toBe('DELETING');
        expect(item.data_activity.stage.name).toBe('REBUILDING');
        expect(monitor._is_host_hideable(host_nodes)).toBe(false);
    });

    it('does not hide a deleting host in REBUILDING stage', () => {
        const host_nodes = load_host('node-a');
        set_stage(host_nodes[0], 'REBUILDING');
        expect(monitor._is_host_hideable(host_nodes)).toBe(false);
    });

    it('hides an offline deleting host whose rebuild finished (WIPING stage)', () => {
        const host_nodes = load_host('node-a', 'node-b');
        for (const item of host_nodes) set_stage(item, 'WIPING');
        expect(monitor._is_host_hideable(host_nodes)).toBe(true);
    });

    it('reaches WIPING through the normal flow once the rebuild is done, then hides', () => {
        const host_nodes = load_host('node-a');
        const [item] = host_nodes;
        monitor._update_status(item);
        item.data_activity.stage.done = true;
        monitor._update_status(item);
        expect(item.data_activity.stage.name).toBe('WIPING');
        expect(item.data_activity.stage.wait_reason).toBe('NODE_OFFLINE');
        expect(monitor._is_host_hideable(host_nodes)).toBe(true);
    });

    it('does not hide an online deleting host', () => {
        const host_nodes = load_host('node-a');
        set_stage(host_nodes[0], 'WIPING');
        host_nodes[0].online = true;
        expect(monitor._is_host_hideable(host_nodes)).toBe(false);
    });
});
