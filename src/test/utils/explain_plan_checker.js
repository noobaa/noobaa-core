/* Copyright (C) 2016 NooBaa */
'use strict';

const assert = require('assert');
const dbg = require('../../util/debug_module')(__filename);
const { PostgresClient } = require('../../util/postgres_client');

/**
 * ExplainPlanChecker intercepts SQL queries executed through postgres_client
 * and captures their EXPLAIN plans. This allows tests to verify that queries
 * hit the expected indexes instead of falling back to sequential scans.
 *
 * Hooks three execution paths:
 * - PostgresClient.executeSQL (raw SQL)
 * - PostgresTable.single_query (ORM-generated queries)
 * - BulkOp factories (ordered, unordered, multi-table batch operations)
 *
 * Usage:
 *   const checker = new ExplainPlanChecker();
 *   checker.enable(md_store);
 *   await md_store.some_function(...);
 *   checker.assert_no_seq_scan(/UPDATE.*objectmds/, 'objectmds');
 *   checker.disable();
 */
class ExplainPlanChecker {
    constructor() {
        /** @type {Array<{query: string, plan?: object[], error?: string}>} */
        this.plans = [];
        this._enabled = false;
        this._originals = {};
        this._table_proto = null;
    }

    /**
     * Enable EXPLAIN capture. Patches prototype methods on PostgresClient,
     * PostgresTable, and BulkOp factories to intercept queries.
     * @param {object} md_store - MDStore instance used to access PostgresTable prototype
     */
    enable(md_store) {
        if (this._enabled) return;
        this._enabled = true;
        this.plans = [];

        const self = this;
        this._table_proto = Object.getPrototypeOf(md_store._objects);

        // 1. Hook PostgresClient.prototype.executeSQL for raw SQL
        this._originals.executeSQL = PostgresClient.prototype.executeSQL;
        PostgresClient.prototype.executeSQL = async function(query, params, options = {}) {
            if (self._should_explain(query)) {
                const pool = this._get_pool_for_sql(options.preferred_pool || 'default');
                await self._run_explain(pool, query, params);
            }
            return self._originals.executeSQL.call(this, query, params, options);
        };

        // 2. Hook BulkOp factories to wrap execute() on each instance
        this._originals.initializeMultiTableBulkOp = PostgresClient.prototype.initializeMultiTableBulkOp;
        PostgresClient.prototype.initializeMultiTableBulkOp = function(pool_name) {
            const bulk = self._originals.initializeMultiTableBulkOp.call(this, pool_name);
            return self._wrap_bulk_execute(bulk);
        };

        this._originals.initializeOrderedBulkOp = this._table_proto.initializeOrderedBulkOp;
        this._table_proto.initializeOrderedBulkOp = function() {
            const bulk = self._originals.initializeOrderedBulkOp.call(this);
            return self._wrap_bulk_execute(bulk);
        };

        this._originals.initializeUnorderedBulkOp = this._table_proto.initializeUnorderedBulkOp;
        this._table_proto.initializeUnorderedBulkOp = function() {
            const bulk = self._originals.initializeUnorderedBulkOp.call(this);
            return self._wrap_bulk_execute(bulk);
        };

        // 3. Hook single_query for ORM-generated queries
        this._originals.single_query = this._table_proto.single_query;
        this._table_proto.single_query = async function(text, values, client, skip_init) {
            if (self._should_explain(text)) {
                const pool = client || this.get_pool();
                await self._run_explain(pool, text, values);
            }
            return self._originals.single_query.call(this, text, values, client, skip_init);
        };
    }

    /**
     * Wrap a BulkOp instance's execute() to run EXPLAIN on each individual
     * query in the batch before executing the batch normally.
     */
    _wrap_bulk_execute(bulk) {
        const self = this;
        const orig_execute = bulk.execute.bind(bulk);
        bulk.execute = async function() {
            const pool = bulk.transaction.pg_pool;
            for (const q of bulk.queries) {
                if (self._should_explain(q)) {
                    await self._run_explain(pool, q);
                }
            }
            return orig_execute();
        };
        return bulk;
    }

    /**
     * Disable EXPLAIN capture and restore all original methods.
     */
    disable() {
        if (!this._enabled) return;
        this._enabled = false;

        if (this._originals.executeSQL) {
            PostgresClient.prototype.executeSQL = this._originals.executeSQL;
        }
        if (this._originals.initializeMultiTableBulkOp) {
            PostgresClient.prototype.initializeMultiTableBulkOp = this._originals.initializeMultiTableBulkOp;
        }
        if (this._table_proto) {
            if (this._originals.initializeOrderedBulkOp) {
                this._table_proto.initializeOrderedBulkOp = this._originals.initializeOrderedBulkOp;
            }
            if (this._originals.initializeUnorderedBulkOp) {
                this._table_proto.initializeUnorderedBulkOp = this._originals.initializeUnorderedBulkOp;
            }
            if (this._originals.single_query) {
                this._table_proto.single_query = this._originals.single_query;
            }
        }

        this._originals = {};
        this._table_proto = null;
    }

    /**
     * Only explain DML statements that can benefit from indexes.
     * Skips DDL, INSERT (always heap-append), BEGIN/COMMIT/ROLLBACK, etc.
     */
    _should_explain(stmt) {
        if (!stmt) return false;
        const upper = stmt.trim().toUpperCase();
        return upper.startsWith('SELECT') ||
               upper.startsWith('UPDATE') ||
               upper.startsWith('DELETE') ||
               upper.startsWith('WITH');
    }

    /**
     * Acquire a connection, disable seq scan (so the planner reveals index
     * eligibility regardless of table size), run EXPLAIN, and capture the plan.
     */
    async _run_explain(pool_or_client, text, values) {
        let client;
        let should_release = false;
        try {
            if (typeof pool_or_client.connect === 'function') {
                client = await pool_or_client.connect();
                should_release = true;
            } else {
                client = pool_or_client;
            }
            await client.query('SET enable_seqscan = off');
            const explain_text = `EXPLAIN (FORMAT JSON) ${text}`;
            const res = await client.query({ text: explain_text, values });
            await client.query('RESET enable_seqscan');

            this.plans.push({
                query: text.trim(),
                plan: res.rows[0]['QUERY PLAN'],
            });
        } catch (err) {
            dbg.warn('ExplainPlanChecker: EXPLAIN failed for query:', text, err.message);
            this.plans.push({
                query: text.trim(),
                error: err.message,
            });
            try { if (client) await client.query('RESET enable_seqscan'); } catch (_) { /* ignore */ }
        } finally {
            if (should_release && client) {
                client.release();
            }
        }
    }

    /** Return a copy of all captured plans. */
    get_plans() {
        return [...this.plans];
    }

    /** Clear all captured plans. */
    clear() {
        this.plans = [];
    }

    /**
     * Find captured plans whose query text matches the given pattern.
     * @param {string|RegExp} pattern - substring or regex to match
     * @returns {Array<{query: string, plan?: object[], error?: string}>}
     */
    find_plans(pattern) {
        return this.plans.filter(p => {
            if (typeof pattern === 'string') return p.query.includes(pattern);
            return pattern.test(p.query);
        });
    }

    /**
     * Recursively collect all "Index Name" values from a plan node tree.
     */
    _extract_indexes(node) {
        const indexes = [];
        if (node['Index Name']) {
            indexes.push(node['Index Name']);
        }
        if (node.Plans) {
            for (const child of node.Plans) {
                indexes.push(...this._extract_indexes(child));
            }
        }
        return indexes;
    }

    /**
     * Recursively collect all "Node Type" values from a plan node tree.
     */
    _extract_node_types(node) {
        const types = [node['Node Type']];
        if (node.Plans) {
            for (const child of node.Plans) {
                types.push(...this._extract_node_types(child));
            }
        }
        return types;
    }

    /**
     * Check if any node in the tree is a Seq Scan on the given table.
     */
    _has_seq_scan_on(node, table_name) {
        if (node['Node Type'] === 'Seq Scan') {
            if (!table_name || node['Relation Name'] === table_name) {
                return true;
            }
        }
        if (node.Plans) {
            for (const child of node.Plans) {
                if (this._has_seq_scan_on(child, table_name)) return true;
            }
        }
        return false;
    }

    /**
     * Assert that all queries matching the pattern use the expected index.
     * @param {string|RegExp} query_pattern - pattern to match query text
     * @param {string|RegExp} expected_index - exact name or regex to match index name
     */
    assert_index_used(query_pattern, expected_index) {
        const matching = this.find_plans(query_pattern);
        assert(matching.length > 0,
            `ExplainPlanChecker: no captured plan matches pattern: ${query_pattern}`);

        for (const entry of matching) {
            if (entry.error) {
                assert.fail(
                    `ExplainPlanChecker: EXPLAIN failed: ${entry.error}\nQuery: ${entry.query}`
                );
            }
            const root = entry.plan[0].Plan;
            const indexes = this._extract_indexes(root);
            const node_types = this._extract_node_types(root);
            const found = typeof expected_index === 'string' ?
                indexes.includes(expected_index) :
                indexes.some(idx => expected_index.test(idx));

            assert(found,
                `ExplainPlanChecker: expected index "${expected_index}" ` +
                `but plan uses: [${indexes.join(', ') || 'none'}], ` +
                `node types: [${node_types.join(' -> ')}]\n` +
                `Query: ${entry.query}`
            );
        }
    }

    /**
     * Assert that no query matching the pattern has a Seq Scan on the given table.
     * @param {string|RegExp} query_pattern - pattern to match query text
     * @param {string} [table_name] - restrict check to this table; omit for any table
     */
    assert_no_seq_scan(query_pattern, table_name) {
        const matching = this.find_plans(query_pattern);
        assert(matching.length > 0,
            `ExplainPlanChecker: no captured plan matches pattern: ${query_pattern}`);

        for (const entry of matching) {
            if (entry.error) {
                assert.fail(
                    `ExplainPlanChecker: EXPLAIN failed: ${entry.error}\nQuery: ${entry.query}`
                );
            }
            const root = entry.plan[0].Plan;
            assert(!this._has_seq_scan_on(root, table_name),
                `ExplainPlanChecker: unexpected Seq Scan` +
                `${table_name ? ` on "${table_name}"` : ''}\n` +
                `Plan: ${JSON.stringify(root, null, 2)}\n` +
                `Query: ${entry.query}`
            );
        }
    }
}

module.exports = { ExplainPlanChecker };
